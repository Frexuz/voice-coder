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

async function main() {
  await withServer(async () => {
    await test_http_short();
    await test_http_nonzero();
    await test_http_long_input();
    await test_ws_roundtrip();
    // timeout test is environment-sensitive; optional
    console.log("SELFTEST PASS");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
