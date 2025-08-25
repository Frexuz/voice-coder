import { spawn } from "child_process";

// Config via env with safe defaults
const CMD = process.env.VC_CMD || process.env.BACKEND_CMD || "echo";
const ARGS = (process.env.VC_ARGS || process.env.BACKEND_ARGS || "")
  .split(/\s+/)
  .filter(Boolean);
const TIMEOUT_MS = Number(process.env.VC_TIMEOUT_MS || 5000);
const MAX_INPUT = Number(process.env.VC_MAX_INPUT || 2000);
const MAX_STDOUT = Number(process.env.VC_MAX_STDOUT || 64 * 1024);
const MAX_STDERR = Number(process.env.VC_MAX_STDERR || 16 * 1024);
const DEBUG =
  String(process.env.VC_DEBUG || "").toLowerCase() === "true" ||
  process.env.VC_DEBUG === "1";

function dbg(...args) {
  if (!DEBUG) return;
  // lightweight, prefixed logger
  console.log("[vc-debug]", ...args);
}

// Shared safe kill helper to avoid duplicate implementations
function safeKill(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGKILL");
  } catch {}
}

function filterAllowedAscii(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Allow TAB(9), LF(10), CR(13), and printable ASCII 0x20-0x7E
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0x7e)
    ) {
      out += str[i];
    }
  }
  return out;
}

function sanitizeText(input, maxLen) {
  const str = String(input ?? "");
  let clean = filterAllowedAscii(str);
  if (clean.length > maxLen) clean = clean.slice(0, maxLen);
  return clean.trim();
}

export function describeConfig() {
  return { CMD, ARGS, TIMEOUT_MS, MAX_INPUT, MAX_STDOUT, MAX_STDERR };
}

export async function runCommandPerRequest(inputText) {
  const text = sanitizeText(inputText, MAX_INPUT);
  if (!text) {
    return {
      ok: false,
      error: "empty_input",
      message: "Please provide some text.",
      status: 400,
    };
  }

  // If original input exceeded, flag it but still run on truncated
  const wasTruncated = String(inputText || "").length > text.length;

  return new Promise((resolve) => {
    const started = Date.now();
    dbg("runner: spawning", {
      cmd: CMD,
      args: ARGS,
      textPreview: text.slice(0, 120),
    });
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    // we do not need a separate stderrTruncated flag for user messages

    let child;
    try {
      child = spawn(CMD, [...ARGS, text], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false, // do NOT use a shell by default
      });
      dbg(`runner: spawned pid=${child.pid}`);
    } catch (err) {
      dbg("runner: spawn_error", err?.message || err);
      resolve({
        ok: false,
        error: "spawn_error",
        message: "Command failed to start.",
        details: String(err?.message || err),
        status: 500,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      safeKill(child);
      dbg(`runner: timeout after ${TIMEOUT_MS}ms, pid=${child.pid}`);
    }, TIMEOUT_MS);

    child.stdout.on("data", (buf) => {
      if (stdout.length >= MAX_STDOUT) {
        stdoutTruncated = true;
        return;
      }
      const chunk = filterAllowedAscii(buf.toString("utf8"));
      stdout += chunk;
      if (DEBUG) {
        const sample = chunk.slice(0, 80).replace(/\n/g, "\\n");
        dbg(
          `runner: stdout +${chunk.length}B (total ${stdout.length})`,
          sample
        );
      }
      if (stdout.length > MAX_STDOUT) {
        stdout = stdout.slice(0, MAX_STDOUT);
        stdoutTruncated = true;
      }
    });

    child.stderr.on("data", (buf) => {
      if (stderr.length >= MAX_STDERR) {
        return;
      }
      const chunk = filterAllowedAscii(buf.toString("utf8"));
      stderr += chunk;
      if (DEBUG) {
        const sample = chunk.slice(0, 80).replace(/\n/g, "\\n");
        dbg(
          `runner: stderr +${chunk.length}B (total ${stderr.length})`,
          sample
        );
      }
      if (stderr.length > MAX_STDERR) {
        stderr = stderr.slice(0, MAX_STDERR);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      dbg("runner: child error", err?.message || err);
      resolve({
        ok: false,
        error: "spawn_error",
        message: "Command failed to start.",
        details: String(err?.message || err),
        status: 500,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const dur = Date.now() - started;
      dbg(
        `runner: close pid=${child.pid} code=${code} signal=${signal} dur=${dur}ms out=${stdout.length}B err=${stderr.length}B${
          timedOut ? " (timed out)" : ""
        }${stdoutTruncated ? " (stdout truncated)" : ""}`
      );
      if (timedOut) {
        resolve({
          ok: false,
          error: "timeout",
          message: `Command timed out after ${Math.round(TIMEOUT_MS / 1000)}s`,
          status: 504,
          stdout,
          stderr,
        });
        return;
      }

      // Final tidy up output
      const out = stdout.trim();
      const err = stderr.trim();

      if (code === 0) {
        const note = [
          wasTruncated ? "[input truncated]" : null,
          stdoutTruncated ? "[output truncated]" : null,
        ]
          .filter(Boolean)
          .join(" ");
        resolve({
          ok: true,
          text: note ? `${out}\n${note}`.trim() : out,
        });
      } else {
        const preview = err || out || "No output";
        resolve({
          ok: false,
          error: "command_failed",
          message: `Command failed (code ${code ?? "unknown"}).`,
          status: 500,
          preview,
          stdout: out,
          stderr: err,
        });
      }
    });
  });
}

// Streaming variant used by WS to emit replyChunk events while the process runs.
// onStdoutChunk/onStderrChunk receive sanitized text chunks as they arrive.
export async function runCommandPerRequestStream(
  inputText,
  { onStdoutChunk, onStderrChunk } = {}
) {
  const text = sanitizeText(inputText, MAX_INPUT);
  if (!text) {
    return {
      ok: false,
      error: "empty_input",
      message: "Please provide some text.",
      status: 400,
    };
  }

  const wasTruncated = String(inputText || "").length > text.length;

  return new Promise((resolve) => {
    const started = Date.now();
    dbg("runner(stream): spawning", {
      cmd: CMD,
      args: ARGS,
      textPreview: text.slice(0, 120),
    });
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;

    let child;
    try {
      child = spawn(CMD, [...ARGS, text], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      dbg(`runner(stream): spawned pid=${child.pid}`);
    } catch (err) {
      dbg("runner(stream): spawn_error", err?.message || err);
      resolve({
        ok: false,
        error: "spawn_error",
        message: "Command failed to start.",
        details: String(err?.message || err),
        status: 500,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      safeKill(child);
      dbg(`runner(stream): timeout after ${TIMEOUT_MS}ms, pid=${child.pid}`);
    }, TIMEOUT_MS);

    child.stdout.on("data", (buf) => {
      if (stdout.length >= MAX_STDOUT) {
        stdoutTruncated = true;
        return;
      }
      const chunk = filterAllowedAscii(buf.toString("utf8"));
      // Emit chunk first for real-time UX
      try {
        if (onStdoutChunk && chunk) onStdoutChunk(chunk);
      } catch {}
      stdout += chunk;
      if (stdout.length > MAX_STDOUT) {
        stdout = stdout.slice(0, MAX_STDOUT);
        stdoutTruncated = true;
      }
    });

    child.stderr.on("data", (buf) => {
      if (stderr.length >= MAX_STDERR) return;
      const chunk = filterAllowedAscii(buf.toString("utf8"));
      try {
        if (onStderrChunk && chunk) onStderrChunk(chunk);
      } catch {}
      stderr += chunk;
      if (stderr.length > MAX_STDERR) {
        stderr = stderr.slice(0, MAX_STDERR);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      dbg("runner(stream): child error", err?.message || err);
      resolve({
        ok: false,
        error: "spawn_error",
        message: "Command failed to start.",
        details: String(err?.message || err),
        status: 500,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const dur = Date.now() - started;
      dbg(
        `runner(stream): close pid=${child.pid} code=${code} signal=${signal} dur=${dur}ms out=${stdout.length}B err=${stderr.length}B${
          timedOut ? " (timed out)" : ""
        }${stdoutTruncated ? " (stdout truncated)" : ""}`
      );
      if (timedOut) {
        resolve({
          ok: false,
          error: "timeout",
          message: `Command timed out after ${Math.round(TIMEOUT_MS / 1000)}s`,
          status: 504,
          stdout,
          stderr,
        });
        return;
      }

      const out = stdout.trim();
      const err = stderr.trim();

      if (code === 0) {
        const note = [
          wasTruncated ? "[input truncated]" : null,
          stdoutTruncated ? "[output truncated]" : null,
        ]
          .filter(Boolean)
          .join(" ");
        resolve({
          ok: true,
          text: note ? `${out}\n${note}`.trim() : out,
        });
      } else {
        const preview = err || out || "No output";
        resolve({
          ok: false,
          error: "command_failed",
          message: `Command failed (code ${code ?? "unknown"}).`,
          status: 500,
          preview,
          stdout: out,
          stderr: err,
        });
      }
    });
  });
}
