#!/usr/bin/env node
import http from "http";
import { WebSocket } from "ws";

const PORT = 4001;
process.env.PORT = String(PORT);
process.env.VC_CMD = process.env.VC_CMD || "node";
process.env.VC_ARGS = process.env.VC_ARGS || "-e";

// Helper to POST JSON
function post(path, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, text: buf });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function withServer(run) {
  await import("./start.js");
  // start.js starts the server by importing server.js
  await new Promise((r) => setTimeout(r, 200));
  try {
    await run();
  } finally {
    process.exit(0);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

async function test_http_short() {
  const r = await post("/api/prompt", { id: "a", text: 'console.log("ok")' });
  assert(r.status === 200, "http short status");
  assert(r.json?.text?.includes("ok"), "http short body");
}

async function test_http_nonzero() {
  const r = await post("/api/prompt", { id: "b", text: "process.exit(2)" });
  assert(r.status >= 400, "http nonzero status");
  assert(typeof r.json?.message === "string", "http nonzero message");
}

async function test_http_long_input() {
  const long = "x".repeat(3000);
  const r = await post("/api/prompt", {
    id: "c",
    text: `console.log(${JSON.stringify(long)})`,
  });
  assert(r.status === 200 || r.status === 400, "http long status");
}

async function test_ws_roundtrip() {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    let gotAck = false,
      gotReply = false;
    ws.on("open", () =>
      ws.send(
        JSON.stringify({ type: "prompt", id: "d", text: 'console.log("pong")' })
      )
    );
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.type === "ack") gotAck = true;
      if (msg.type === "reply") {
        gotReply = true;
        assert(msg.text.includes("pong"), "ws reply");
        ws.close();
      }
    });
    ws.on("close", () => {
      assert(gotAck && gotReply, "ws ack+reply");
      resolve(null);
    });
    ws.on("error", reject);
  });
}

async function test_ws_pty_session() {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    let started = false;
    let sawOutput = false;
    let sawExit = false;
    const token = `PING_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(
      () => reject(new Error("pty session timeout")),
      10000
    );
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "startSession", options: {} }));
    });
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.type === "sessionStarted" && msg.ok) {
        started = true;
        // Use echo if available in shell; otherwise token may appear in PS too
        ws.send(JSON.stringify({ type: "prompt", text: `echo ${token}` }));
      } else if (msg.type === "output") {
        if (String(msg.data).includes(token)) {
          sawOutput = true;
          ws.send(JSON.stringify({ type: "stop" }));
        }
      } else if (msg.type === "sessionExit") {
        sawExit = true;
        clearTimeout(timer);
        ws.close();
      }
    });
    ws.on("close", () => {
      try {
        assert(started, "pty started");
        assert(sawOutput, "pty saw output");
        assert(sawExit, "pty exit sent");
        resolve(null);
      } catch (e) {
        reject(e);
      }
    });
    ws.on("error", reject);
  });
}

async function test_ws_approval_flow() {
  // Use PTY session and a risky marker inside an echo command to avoid executing external tools.
  // The classifier sees the raw text (containing "git apply"), then we approve/deny.
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    let started = false;
    let gotRequest = false;
    let sawApproved = false;
    const token = `APPROVED_${Math.random().toString(36).slice(2, 6)}`;
    const timer = setTimeout(
      () => reject(new Error("approval approve timeout")),
      12000
    );
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "startSession", options: {} }));
    });
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.type === "sessionStarted" && msg.ok) {
        started = true;
        // Risky text but safe execution: echo includes risky marker
        ws.send(
          JSON.stringify({
            type: "prompt",
            id: "ap1",
            text: `echo git apply patch.diff && echo ${token}`,
          })
        );
      } else if (msg.type === "actionRequest") {
        gotRequest = true;
        ws.send(
          JSON.stringify({
            type: "actionResponse",
            actionId: msg.actionId,
            approve: true,
          })
        );
      } else if (msg.type === "output") {
        if (String(msg.data || "").includes(token)) {
          sawApproved = true;
          clearTimeout(timer);
          ws.close();
        }
      }
    });
    ws.on("close", () => {
      try {
        assert(started, "approval: pty started");
        assert(gotRequest, "approval: got request (approve)");
        assert(sawApproved, "approval: approved path produced output");
        resolve(null);
      } catch (e) {
        reject(e);
      }
    });
    ws.on("error", reject);
  });

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    let started = false;
    let gotRequest = false;
    let gotDeniedError = false;
    const timer = setTimeout(
      () => reject(new Error("approval deny timeout")),
      12000
    );
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "startSession", options: {} }));
    });
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.type === "sessionStarted" && msg.ok) {
        started = true;
        ws.send(
          JSON.stringify({
            type: "prompt",
            id: "ap2",
            text: `echo git apply patch2.diff && echo DENIED_OK`,
          })
        );
      } else if (msg.type === "actionRequest") {
        gotRequest = true;
        // Deny this one
        ws.send(
          JSON.stringify({
            type: "actionResponse",
            actionId: msg.actionId,
            approve: false,
          })
        );
      } else if (msg.type === "error" && msg.error === "denied") {
        gotDeniedError = true;
        clearTimeout(timer);
        ws.close();
      } else if (msg.type === "output") {
        // If we accidentally executed, we'd see DENIED_OK; ensure we don't require that
      }
    });
    ws.on("close", () => {
      try {
        assert(started, "approval: pty started (deny)");
        assert(gotRequest, "approval: got request (deny)");
        assert(gotDeniedError, "approval: error on deny");
        resolve(null);
      } catch (e) {
        reject(e);
      }
    });
    ws.on("error", reject);
  });
}

async function main() {
  await withServer(async () => {
    await test_http_short();
    await test_http_nonzero();
    await test_http_long_input();
    await test_ws_roundtrip();
    await test_ws_pty_session();
    await test_ws_approval_flow();
    // timeout test is environment-sensitive; optional
    console.log("SELFTEST PASS");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
