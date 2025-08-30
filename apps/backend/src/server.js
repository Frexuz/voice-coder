import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import {
  runCommandPerRequest,
  runCommandPerRequestStream,
  describeConfig,
} from "./runner.js";
import * as pty from "./ptySession.js";
// Phase 5 engine switch: heuristic vs LLM
import {
  summarizeIfChanged,
  summarizerHealth,
  summarizerEngine,
  summarizeEngine,
} from "./summarizer_engine.js";
import { execSync } from "child_process";
const DEBUG =
  String(process.env.VC_DEBUG || "").toLowerCase() === "true" ||
  process.env.VC_DEBUG === "1" ||
  String(process.env.C_DEBUG || "").toLowerCase() === "true" ||
  process.env.C_DEBUG === "1";
const dbg = (...args) => {
  if (DEBUG) console.log("[vc-debug]", ...args);
};

const app = express();
dbg("startup: debug enabled");
// On macOS, if SSH_AUTH_SOCK isn't present (e.g., when started via Turbo), try to fetch from launchctl
if (!process.env.SSH_AUTH_SOCK && process.platform === "darwin") {
  try {
    const sock = execSync("launchctl getenv SSH_AUTH_SOCK", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sock) process.env.SSH_AUTH_SOCK = sock;
  } catch {}
}
dbg("startup: pty availability", {
  available: pty.isAvailable?.() || false,
  lastError: pty.getLastImportErrorMessage?.(),
});
dbg("startup: SSH_AUTH_SOCK", process.env.SSH_AUTH_SOCK || null);
app.use(cors());
app.use(express.json());

// Phase 5: summarizer health endpoint
app.get("/api/summarizer/health", async (_req, res) => {
  try {
    const h = await summarizerHealth();
    const engine = summarizerEngine();
    console.log("[vc] summarizer.health", { engine, h });
    res.json({ engine, ...h });
  } catch (e) {
    res.status(500).json({
      engine: summarizerEngine(),
      ok: false,
      error: String(e?.message || e),
    });
  }
});

// --- Phase 4: Approvals and safe actions (config + helpers) ---
const APPROVAL_ALWAYS =
  String(process.env.VC_APPROVAL_ALWAYS || "").toLowerCase() === "true" ||
  process.env.VC_APPROVAL_ALWAYS === "1";
const APPROVAL_TIMEOUT_MS = Number(process.env.VC_APPROVAL_TIMEOUT_MS || 15000);
// Comma-separated list of regex fragments or keywords. Defaults cover installs, network, destructive VCS/fs, diff apply.
const DEFAULT_APPROVAL_PATTERNS = [
  "\\bgit\\s+apply\\b|^diff --git ",
  "\\b(pnpm|npm|yarn)\\s+install\\b",
  "\\b(pip3?|brew|apt(?:-get)?|yum|dnf)\\s+install\\b",
  "\\b(curl|wget)\\s+https?://",
  "\\bgit\\s+push\\b|\\bgit\\s+reset\\s+--hard\\b",
  "\\brm\\s+-rf\\b|\\bchmod\\s+|\\bchown\\s+|\\bsystemctl\\s+",
  "\\bdocker\\s+(run|pull|push|compose)\\b",
  "\\bkubectl\\s+apply\\b|\\bhelm\\s+install\\b",
];
const APPROVAL_PATTERNS_RAW = process.env.VC_APPROVAL_PATTERNS || "";
let APPROVAL_PATTERNS = DEFAULT_APPROVAL_PATTERNS;
try {
  const items = APPROVAL_PATTERNS_RAW.split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length) APPROVAL_PATTERNS = items;
} catch {}
const APPROVAL_REGEXES = APPROVAL_PATTERNS.map((p) => new RegExp(p, "i"));

function classifyRiskFromText(text) {
  const s = String(text || "");
  const reasons = [];
  for (const rx of APPROVAL_REGEXES) {
    if (rx.test(s)) reasons.push(`matches: ${String(rx)}`);
    if (reasons.length >= 3) break;
  }
  if (APPROVAL_ALWAYS && reasons.length === 0) reasons.push("approval_always");
  return { risky: reasons.length > 0, reasons };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function ensureApprovalState(ws) {
  if (!ws._approvals) {
    ws._approvals = {
      pending: new Map(), // actionId -> {resolve, timer}
    };
  }
}

function awaitApproval(ws, req) {
  // req: { reason, textPreview, risks[]? }
  ensureApprovalState(ws);
  const actionId = randomId();
  const payload = {
    type: "actionRequest",
    actionId,
    reason: req.reason || "approval_required",
    risks: req.risks || [],
    preview: String(req.textPreview || "").slice(0, 500),
    timeoutMs: APPROVAL_TIMEOUT_MS > 0 ? APPROVAL_TIMEOUT_MS : undefined,
  };
  send(ws, payload);
  return new Promise((resolve) => {
    let timer = null;
    if (APPROVAL_TIMEOUT_MS > 0) {
      timer = setTimeout(() => {
        // auto-deny on timeout
        try {
          send(ws, {
            type: "actionResolved",
            actionId,
            approved: false,
            reason: "timeout",
          });
        } catch {}
        ws._approvals.pending.delete(actionId);
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);
    }
    ws._approvals.pending.set(actionId, {
      resolve: (approved) => {
        if (timer) clearTimeout(timer);
        try {
          send(ws, { type: "actionResolved", actionId, approved });
        } catch {}
        ws._approvals.pending.delete(actionId);
        resolve(approved);
      },
    });
  });
}

app.post("/api/prompt", async (req, res) => {
  const { id, text } = req.body || {};
  if (!text) return res.status(400).json({ error: "missing text" });

  try {
    dbg("http: prompt", { id, textPreview: String(text).slice(0, 120) });
    const result = await runCommandPerRequest(text);
    if (result.ok) {
      dbg("http: ok", { id, bytes: result.text?.length || 0 });
      return res.json({ id, text: result.text });
    }
    const status = result.status || 500;
    dbg("http: error", {
      id,
      status,
      error: result.error,
      message: result.message,
    });
    return res.status(status).json({
      id,
      error: result.error || "command_failed",
      message: result.message || "Command failed.",
      preview: result.preview,
    });
  } catch (err) {
    dbg("http: exception", err?.message || err);
    return res
      .status(500)
      .json({ error: "server_error", message: "Unexpected error." });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
dbg("startup: ws server created");

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

// Helper to get the current raw output buffer (PTY or non-PTY aggregate)
function getCurrentBuffer(ws) {
  const fromWs = ws && typeof ws._agg === "string" ? ws._agg : "";
  const canCheck = pty && typeof pty.isRunning === "function";
  if (canCheck && pty.isRunning()) {
    const getBuf = typeof pty.getBuffer === "function" ? pty.getBuffer : null;
    const buf = getBuf ? getBuf() : "";
    return typeof buf === "string" && buf.length ? buf : fromWs;
  }
  return fromWs;
}

// --- Phase 6: On-demand expansion (slices) helpers ---
function extractLatestDiff(buf) {
  const s = String(buf || "");
  // Try to find last unified diff starting with 'diff --git' block
  const matches = [];
  const rxGit = /^diff --git .*$/gm;
  for (;;) {
    const m2 = rxGit.exec(s);
    if (!m2) break;
    matches.push(m2.index);
  }
  if (matches.length > 0) {
    const start = matches[matches.length - 1];
    // End at next diff --git or end of buffer
    const rest = s.slice(start + 1);
    const next = rest.search(/^diff --git .*$/m);
    const end = next === -1 ? s.length : start + 1 + next;
    return s.slice(start, end).trim();
  }
  // Fallback: look for '---' + '+++' headers
  const rxHdr = /^---\s+.*\n\+\+\+\s+.*$/gm;
  let last = null;
  for (;;) {
    const m2 = rxHdr.exec(s);
    if (!m2) break;
    last = m2.index;
  }
  if (last != null) {
    const rest = s.slice(last + 1);
    const next = rest.search(/^---\s+/m);
    const end = next === -1 ? s.length : last + 1 + next;
    return s.slice(last, end).trim();
  }
  return "";
}

function extractFirstTestFailure(buf) {
  const s = String(buf || "");
  // Look for common Jest/Vitest failure markers
  // e.g., "FAIL " line then capture until blank lines or next FAIL/PASS
  const rxFail = /^(FAIL|✖|x)\b.*$/gim;
  const m = rxFail.exec(s);
  if (m) {
    const start = m.index;
    const rest = s.slice(start);
    const next = rest.search(/\n\s*\n|^PASS\b|^FAIL\b|^Test Suites?:/m);
    const body = next === -1 ? rest : rest.slice(0, next);
    return body.trim();
  }
  // Another hint: lines starting with "●" or "AssertionError"
  const rxDot = /^\s*[●✖x].*$/gim;
  const m2 = rxDot.exec(s);
  if (m2) {
    const start = m2.index;
    const rest = s.slice(start);
    const next = rest.search(/\n\s*\n/);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  }
  return "";
}

function extractLastErrorStack(buf) {
  const s = String(buf || "");
  // Collect all occurrences of lines starting with 'Error' or containing 'Unhandled' and include subsequent stack lines (' at ')
  const lines = s.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/\b(Error|Unhandled|Exception)\b/.test(L)) start = i;
  }
  if (start === -1) return "";
  const chunk = [];
  for (let i = start; i < lines.length; i++) {
    const L = lines[i];
    chunk.push(L);
    // Stop when a blank line after at least one stack frame
    if (i > start && /^\s*$/.test(L)) break;
  }
  // Extend to include following ' at ' frames
  for (let i = chunk.length; start + i < lines.length; i++) {
    const L = lines[start + i];
    if (/^\s+at\s+/.test(L)) chunk.push(L);
    else break;
  }
  return chunk.join("\n").trim();
}

// Debounced summary scheduler to coalesce rapid output bursts
function scheduleSummary(ws) {
  try {
    if (ws._summaryTimer) clearTimeout(ws._summaryTimer);
    if (!ws._summaryInFlight) {
      ws._summaryInFlight = true;
      try {
        send(ws, {
          type: "summaryStatus",
          running: true,
          correlationId: ws._corr || null,
        });
      } catch {}
    }
    ws._summaryTimer = setTimeout(async () => {
      try {
        // Use PTY buffer if a PTY session is active; otherwise use the per-WS aggregate from streaming runs
        const buf = pty.isRunning() ? pty.getBuffer() : ws._agg || "";
        const s = await summarizeIfChanged(buf || "", ws._summaryHash || null);
        if (s.changed && s.summary) {
          ws._summaryHash = s.hash;
          ws._lastSummary = s.summary;
          send(ws, {
            type: "summaryUpdate",
            correlationId: ws._corr || null,
            summary: s.summary,
          });
        }
      } catch {
      } finally {
        ws._summaryInFlight = false;
        try {
          send(ws, {
            type: "summaryStatus",
            running: false,
            correlationId: ws._corr || null,
          });
        } catch {}
      }
    }, 500);
  } catch {}
}

async function handleStartSession(ws, msg) {
  try {
    const r = pty.start(msg.options || {});
    // PTY sessions stream through the PTY buffer; clear any leftover non-PTY aggregate
    ws._agg = "";
    send(ws, {
      type: "sessionStarted",
      ok: !!r?.ok,
      cfg: pty.getConfig(),
      running: pty.isRunning(),
    });
    const existing = pty.getBuffer();
    if (existing) send(ws, { type: "output", data: existing });
    // Send initial summary of existing buffer
    scheduleSummary(ws, "init");
    // Prevent duplicate listeners: only add if not already added for this ws
    if (!ws._ptyListenersAdded) {
      ws._ptyListenersAdded = true;
      const offData = pty.onOutput(async (chunk) => {
        send(ws, { type: "output", data: chunk });
        scheduleSummary(ws, "pty");
      });
      const offExit = pty.onExit((info) =>
        send(ws, { type: "sessionExit", info })
      );
      ws.once("close", () => {
        offData();
        offExit();
        try {
          if (ws._summaryTimer) clearTimeout(ws._summaryTimer);
        } catch {}
        ws._summaryInFlight = false;
      });
    }
  } catch (err) {
    dbg("ws: startSession failed", err?.message || String(err));
    send(ws, {
      type: "error",
      error: "pty_start_failed",
      message:
        (err && (err.message || String(err))) ||
        "Failed to start PTY. Ensure node-pty is installed.",
    });
    send(ws, { type: "sessionStarted", ok: false, running: false });
  }
}

async function handlePrompt(ws, msg) {
  dbg("ws: prompt", {
    id: msg.id,
    textPreview: String(msg.text).slice(0, 120),
  });
  send(ws, { type: "ack", id: msg.id });
  // Start a new correlation for this prompt (non-PTY flow)
  ws._corr = String(msg.id || randomId());
  ws._summaryHash = null;
  ws._lastSummary = null;

  // Phase 4: Check for risky content and request approval if needed
  const risk = classifyRiskFromText(msg.text);
  if (risk.risky) {
    const approved = await awaitApproval(ws, {
      reason: "risky_action_detected",
      risks: risk.reasons,
      textPreview: msg.text,
    });
    if (!approved) {
      return send(ws, {
        type: "error",
        id: msg.id,
        error: "denied",
        message: "Action denied (approval required).",
      });
    }
  }
  if (pty.isRunning()) {
    try {
      pty.write(String(msg.text) + "\n");
    } catch (err) {
      dbg("ws: pty write error", err?.message || err);
    }
    return;
  }
  try {
    // Non-PTY streaming run: reset per-WS aggregate and build it from stdout chunks
    ws._agg = "";
    const result = await runCommandPerRequestStream(msg.text, {
      onStdoutChunk: async (chunk) => {
        ws._agg += String(chunk || "");
        // Stream to client as replyChunk when not using PTY
        send(ws, {
          type: "replyChunk",
          id: msg.id,
          correlationId: ws._corr || null,
          data: chunk,
        });
        // Debounced summary on new output
        scheduleSummary(ws);
      },
      onStderrChunk: (chunk) => {
        // For visibility, also stream stderr chunks
        send(ws, {
          type: "replyChunk",
          id: msg.id,
          correlationId: ws._corr || null,
          data: chunk,
          stderr: true,
        });
      },
    });
    if (result.ok) {
      dbg("ws: ok", { id: msg.id, bytes: result.text?.length || 0 });
      send(ws, {
        type: "reply",
        id: msg.id,
        correlationId: ws._corr || null,
        text: result.text,
      });
      // Final summary snapshot (force-send, even if identical)
      try {
        if (ws._summaryTimer) clearTimeout(ws._summaryTimer);
      } catch {}
      ws._summaryInFlight = false;
      const buf = ws._agg || "";
      try {
        const finalSummary = await summarizeEngine(buf);
        ws._lastSummary = finalSummary || null;
        send(ws, {
          type: "summaryFinal",
          correlationId: ws._corr || null,
          summary: finalSummary || null,
        });
      } catch {}
      // Ensure status reflects completion
      try {
        send(ws, {
          type: "summaryStatus",
          running: false,
          correlationId: ws._corr || null,
        });
      } catch {}
    } else {
      dbg("ws: error", {
        id: msg.id,
        error: result.error,
        status: result.status,
        message: result.message,
      });
      send(ws, {
        type: "error",
        id: msg.id,
        error: result.error || "command_failed",
        message: result.message || "Command failed.",
        preview: result.preview,
      });
      // Even on error, emit a final snapshot of whatever we captured
      try {
        if (ws._summaryTimer) clearTimeout(ws._summaryTimer);
      } catch {}
      ws._summaryInFlight = false;
      const buf = ws._agg || "";
      try {
        const finalSummary = await summarizeEngine(buf);
        ws._lastSummary = finalSummary || null;
        send(ws, {
          type: "summaryFinal",
          correlationId: ws._corr || null,
          summary: finalSummary || null,
        });
      } catch {}
      try {
        send(ws, {
          type: "summaryStatus",
          running: false,
          correlationId: ws._corr || null,
        });
      } catch {}
    }
  } catch (err) {
    dbg("ws: exception", err?.message || err);
    send(ws, {
      type: "error",
      id: msg.id,
      error: "server_error",
      message: "Unexpected error.",
    });
    // Exception path: try to finalize too
    try {
      if (ws._summaryTimer) clearTimeout(ws._summaryTimer);
    } catch {}
    ws._summaryInFlight = false;
    const buf = ws._agg || "";
    try {
      const finalSummary = await summarizeEngine(buf);
      ws._lastSummary = finalSummary || null;
      send(ws, {
        type: "summaryFinal",
        correlationId: ws._corr || null,
        summary: finalSummary || null,
      });
    } catch {}
    try {
      send(ws, {
        type: "summaryStatus",
        running: false,
        correlationId: ws._corr || null,
      });
    } catch {}
  }
}

function handleInterrupt() {
  pty.interrupt();
}
function handleReset() {
  pty.reset();
}
function handleStop() {
  pty.stop();
}

function handleResize(msg) {
  const { cols, rows } = msg || {};
  pty.resize(Number(cols), Number(rows));
}

wss.on("connection", (ws, req) => {
  dbg("ws: connection", { url: req?.url });
  ws.on("message", async (data) => {
    dbg("ws: message", { raw: String(data).slice(0, 120) });
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      dbg("ws: invalid json", err?.message || String(err));
      return send(ws, { type: "error", message: "invalid json" });
    }
    try {
      switch (msg.type) {
        case "hello":
          return send(ws, { type: "hello", ok: true });
        case "startSession":
          dbg("ws: startSession", { options: msg.options || {} });
          return handleStartSession(ws, msg);
        case "prompt":
          dbg("ws: prompt received");
          return handlePrompt(ws, msg);
        case "actionResponse": {
          // Phase 4: receive approval decision
          ensureApprovalState(ws);
          const actionId = String(msg.actionId || "");
          const approved = !!msg.approve;
          const entry = ws._approvals.pending.get(actionId);
          if (entry) {
            try {
              entry.resolve(approved);
            } catch {}
          }
          return;
        }
        case "interrupt":
          dbg("ws: interrupt");
          return handleInterrupt();
        case "resize":
          dbg("ws: resize", { cols: msg?.cols, rows: msg?.rows });
          return handleResize(msg);
        case "reset":
          dbg("ws: reset");
          return handleReset();
        case "stop":
          dbg("ws: stop");
          return handleStop();
        case "expandRequest": {
          // Phase 6: return a requested slice of the current buffer
          const requestId = String(msg.requestId || randomId());
          const expandType = String(msg.expandType || "");
          // params reserved for future filtering (e.g., specific file)
          const buf = getCurrentBuffer(ws);
          let content = "";
          let title = "";
          let mime = "text/plain";
          try {
            if (expandType === "diff") {
              content = extractLatestDiff(buf);
              title = "Latest diff";
              mime = "text/x-diff";
            } else if (expandType === "first-failure") {
              content = extractFirstTestFailure(buf);
              title = "First failing test";
            } else if (expandType === "last-error") {
              content = extractLastErrorStack(buf);
              title = "Last error";
            } else {
              return send(ws, {
                type: "expandResponse",
                requestId,
                ok: false,
                error: "unknown_expand_type",
                message: `Unknown expandType: ${expandType}`,
              });
            }
            if (!content) {
              return send(ws, {
                type: "expandResponse",
                requestId,
                ok: false,
                error: "no_content",
                message: "No matching content found in buffer.",
              });
            }
            return send(ws, {
              type: "expandResponse",
              requestId,
              ok: true,
              kind: expandType,
              title,
              mime,
              content,
            });
          } catch (e) {
            return send(ws, {
              type: "expandResponse",
              requestId,
              ok: false,
              error: "expand_failed",
              message: String(e?.message || e),
            });
          }
        }
        default:
          return send(ws, { type: "error", message: "unknown message type" });
      }
    } catch (err) {
      dbg("ws: handler exception", err?.message || String(err));
    }
  });
  ws.on("close", (code, reason) => {
    dbg("ws: close", { code, reason: String(reason || "") });
  });
  ws.on("error", (err) => {
    dbg("ws: error", err?.message || String(err));
  });
});

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/ws") {
      dbg("ws: upgrade /ws");
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      dbg("ws: upgrade unknown path", { path: url.pathname });
      socket.destroy();
    }
  } catch {
    dbg("ws: upgrade error");
    socket.destroy();
  }
});

const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
  const cfg = describeConfig();
  console.log(
    `backend listening on http://localhost:${PORT} (cmd: ${cfg.CMD} ${cfg.ARGS.join(" ") || "<none>"}, timeout: ${cfg.TIMEOUT_MS}ms)`
  );
  dbg("startup: config", cfg);
});
