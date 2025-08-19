import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import { runCommandPerRequest, describeConfig } from "./runner.js";
import * as pty from "./ptySession.js";
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
dbg("startup: pty availability", {
  available: pty.isAvailable?.() || false,
  lastError: pty.getLastImportErrorMessage?.(),
});
app.use(cors());
app.use(express.json());

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

function handleStartSession(ws, msg) {
  try {
    const r = pty.start(msg.options || {});
    send(ws, {
      type: "sessionStarted",
      ok: !!r?.ok,
      cfg: pty.getConfig(),
      running: pty.isRunning(),
    });
    const existing = pty.getBuffer();
    if (existing) send(ws, { type: "output", data: existing });
    const offData = pty.onOutput((chunk) =>
      send(ws, { type: "output", data: chunk })
    );
    const offExit = pty.onExit((info) =>
      send(ws, { type: "sessionExit", info })
    );
    ws.once("close", () => {
      offData();
      offExit();
    });
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
  if (pty.isRunning()) {
    try {
      pty.write(String(msg.text) + "\n");
    } catch (err) {
      dbg("ws: pty write error", err?.message || err);
    }
    return;
  }
  try {
    const result = await runCommandPerRequest(msg.text);
    if (result.ok) {
      dbg("ws: ok", { id: msg.id, bytes: result.text?.length || 0 });
      send(ws, { type: "reply", id: msg.id, text: result.text });
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
    }
  } catch (err) {
    dbg("ws: exception", err?.message || err);
    send(ws, {
      type: "error",
      id: msg.id,
      error: "server_error",
      message: "Unexpected error.",
    });
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
        case "interrupt":
          dbg("ws: interrupt");
          return handleInterrupt();
        case "reset":
          dbg("ws: reset");
          return handleReset();
        case "stop":
          dbg("ws: stop");
          return handleStop();
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
