import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import { runCommandPerRequest, describeConfig } from "./runner.js";
const DEBUG =
  String(process.env.VC_DEBUG || "").toLowerCase() === "true" ||
  process.env.VC_DEBUG === "1";
const dbg = (...args) => {
  if (DEBUG) console.log("[vc-debug]", ...args);
};

const app = express();
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

wss.on("connection", (ws) => {
  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      dbg("ws: invalid json", err?.message || String(err));
      ws.send(JSON.stringify({ type: "error", message: "invalid json" }));
      return;
    }
    try {
      if (msg.type === "prompt") {
        dbg("ws: prompt", {
          id: msg.id,
          textPreview: String(msg.text).slice(0, 120),
        });
        ws.send(JSON.stringify({ type: "ack", id: msg.id }));
        try {
          const result = await runCommandPerRequest(msg.text);
          if (result.ok) {
            dbg("ws: ok", { id: msg.id, bytes: result.text?.length || 0 });
            ws.send(
              JSON.stringify({ type: "reply", id: msg.id, text: result.text })
            );
          } else {
            dbg("ws: error", {
              id: msg.id,
              error: result.error,
              status: result.status,
              message: result.message,
            });
            ws.send(
              JSON.stringify({
                type: "error",
                id: msg.id,
                error: result.error || "command_failed",
                message: result.message || "Command failed.",
                preview: result.preview,
              })
            );
          }
        } catch (err) {
          dbg("ws: exception", err?.message || err);
          ws.send(
            JSON.stringify({
              type: "error",
              id: msg.id,
              error: "server_error",
              message: "Unexpected error.",
            })
          );
        }
      }
    } catch (err) {
      dbg("ws: handler exception", err?.message || String(err));
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
  const cfg = describeConfig();
  console.log(
    `backend listening on http://localhost:${PORT} (cmd: ${cfg.CMD} ${cfg.ARGS.join(" ") || "<none>"}, timeout: ${cfg.TIMEOUT_MS}ms)`
  );
});
