import process from "process";
let ptyLib;
let lastImportError = null;
try {
  const mod = await import("node-pty");
  ptyLib = mod && (mod.default || mod);
} catch (e) {
  lastImportError = e;
}

const DEBUG =
  String(process.env.VC_DEBUG || "").toLowerCase() === "true" ||
  process.env.VC_DEBUG === "1";
const dbg = (...args) => {
  if (DEBUG) console.log("[vc-debug]", ...args);
};

// Ring buffer of recent output (by bytes)
const MAX_BUFFER = Number(process.env.VC_PTY_MAX_BUFFER || 10 * 1024 * 10); // ~100KB

const state = {
  pty: null,
  cfg: null,
  buffer: "",
  listeners: new Set(),
  exitListeners: new Set(),
};

function appendBuffer(chunk) {
  if (!chunk) return;
  state.buffer += chunk;
  if (state.buffer.length > MAX_BUFFER) {
    state.buffer = state.buffer.slice(state.buffer.length - MAX_BUFFER);
  }
}

export function isRunning() {
  return !!state.pty;
}

export function isAvailable() {
  return !!ptyLib;
}

export function getLastImportErrorMessage() {
  return lastImportError
    ? String(lastImportError?.message || lastImportError)
    : null;
}

export function onOutput(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function onExit(fn) {
  state.exitListeners.add(fn);
  return () => state.exitListeners.delete(fn);
}

function emitOutput(chunk) {
  for (const fn of state.listeners) {
    try {
      fn(chunk);
    } catch {}
  }
}

function emitExit(info) {
  for (const fn of state.exitListeners) {
    try {
      fn(info);
    } catch {}
  }
}

export function getBuffer() {
  return state.buffer;
}

export function getConfig() {
  return state.cfg;
}

export function stop() {
  if (state.pty) {
    try {
      state.pty.kill();
    } catch {}
    state.pty = null;
    dbg("pty: stopped");
  }
}

export function interrupt() {
  if (state.pty) {
    try {
      state.pty.write("\x03");
      dbg("pty: sent SIGINT (Ctrl-C)");
    } catch {}
  }
}

export function write(data) {
  if (!state.pty) throw new Error("PTY not running");
  state.pty.write(data);
}

export function reset() {
  const cfg = state.cfg;
  stop();
  if (cfg) return start(cfg);
}

export function start(options = {}) {
  if (!ptyLib) {
    throw new Error(
      "node-pty not installed. Run package install in apps/backend."
    );
  }
  if (state.pty) {
    dbg("pty: already running");
    return { ok: true, alreadyRunning: true, cfg: state.cfg };
  }
  const shell =
    options.cmd ||
    process.env.VC_PTY_CMD ||
    process.env.SHELL ||
    (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
  let args = options.args;
  if (!args) {
    if (process.env.VC_PTY_ARGS) {
      args = process.env.VC_PTY_ARGS.split(/\s+/).filter(Boolean);
    } else {
      args = process.platform === "win32" ? [] : ["-i"];
    }
  }
  const cols = Number(process.env.VC_PTY_COLS || 120);
  const rows = Number(process.env.VC_PTY_ROWS || 30);
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };

  dbg("pty: starting", { shell, args, cwd, cols, rows });
  if (!ptyLib && lastImportError) {
    throw lastImportError;
  }
  const pty = ptyLib.spawn(shell, args, { cols, rows, cwd, env });
  state.pty = pty;
  state.cfg = { shell, args, cwd, cols, rows };
  state.buffer = "";

  pty.onData((data) => {
    appendBuffer(data);
    emitOutput(data);
  });

  pty.onExit((e) => {
    dbg("pty: exit", e);
    emitExit(e);
    state.pty = null;
  });

  return { ok: true, pid: pty.pid, cfg: state.cfg };
}
