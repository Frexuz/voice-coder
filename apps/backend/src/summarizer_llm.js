// Phase 5: Local summarizer model (map-reduce) via Ollama HTTP API
// Provides a JSON-structured summary for large outputs using a small local model.
// Falls back to heuristic summary on errors.

import http from "http";
import https from "https";

const DEBUG =
  String(process.env.VC_DEBUG || "").toLowerCase() === "true" ||
  process.env.VC_DEBUG === "1";
const dbg = (...args) => {
  if (DEBUG) console.log("[vc-debug]", ...args);
};

// Config
const OLLAMA_URL = process.env.VC_OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.VC_OLLAMA_MODEL || "qwen2.5:3b-instruct-q4_0";
const MAX_INPUT_CHARS = Number(process.env.VC_SUMMARY_MAX_INPUT || 200_000);
const CHUNK_CHARS = Number(process.env.VC_SUMMARY_CHUNK_SIZE || 6_000); // ~1-2k tokens for many Q4 models
const TIMEOUT_MS = Number(process.env.VC_SUMMARY_TIMEOUT_MS || 15_000);
const MAP_SYS =
  process.env.VC_SUMMARY_MAP_SYS ||
  "You compress arbitrary developer tool output into strict JSON.";
const MAP_PROMPT =
  process.env.VC_SUMMARY_MAP_PROMPT ||
  `You are compressing developer tool logs. Output JSON ONLY with fields:
  {"version":"1.0","bullets":[string<=5],"filesChanged":[{"path":string,"adds":number,"dels":number}],"tests":{"passed":number,"failed":number,"failures":[{"name":string,"message":string}]},"errors":[{"type":string,"message":string,"file"?:string,"line"?:number}],"actions":["apply"|"rerun"|"open_pr"|"fix_tests"],"metrics":{"durationMs"?:number,"commandsRun"?:number,"exitCode"?:number}}
  - Summarize ONLY this chunk; do not assume other chunks.
  - If a field is unknown, provide a sensible default (e.g., [] or 0).
  - Return compact JSON; no markdown or commentary.`;
const REDUCE_PROMPT =
  process.env.VC_SUMMARY_REDUCE_PROMPT ||
  `Given N JSON chunk-summaries (same schema), output a single consolidated JSON with the same schema. Merge duplicates, sum counts, keep unique bullets (<=6), prioritize failures and risky files. JSON ONLY.`;

function cutTail(s, max) {
  const str = String(s || "");
  if (str.length <= max) return str;
  return str.slice(str.length - max);
}

function toChunks(s, size) {
  const arr = [];
  for (let i = 0; i < s.length; i += size) arr.push(s.slice(i, i + size));
  return arr;
}

function simpleHash(s) {
  let h = 0;
  for (let i = Math.max(0, s.length - 5000); i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function httpRequestJson(method, url, body, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const isHttps = u.protocol === "https:";
      const lib = isHttps ? https : http;
      const hasBody = body !== undefined && body !== null;
      const data = hasBody ? Buffer.from(JSON.stringify(body)) : null;
      let reqPort;
      if (u.port) {
        reqPort = Number(u.port);
      } else if (isHttps) {
        reqPort = 443;
      } else {
        reqPort = 80;
      }
      const headers = { "content-type": "application/json" };
      if (hasBody) headers["content-length"] = String(data.length);
      const req = lib.request(
        {
          method,
          hostname: u.hostname,
          port: reqPort,
          path: u.pathname + (u.search || ""),
          headers,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks).toString("utf8");
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              try {
                const parsed = JSON.parse(buf);
                resolve(parsed);
              } catch (e) {
                const err = new Error("invalid_json_response");
                err.details = String(e?.message || e);
                reject(err);
              }
            } else {
              reject(new Error(`http_${res.statusCode || 0}`));
            }
          });
        }
      );
      req.setTimeout(timeoutMs, () => {
        try {
          req.destroy(new Error("timeout"));
        } catch {}
      });
      req.on("error", reject);
      if (hasBody && data) req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function httpPostJson(url, body, opts) {
  return httpRequestJson("POST", url, body, opts);
}

function httpGetJson(url, opts) {
  return httpRequestJson("GET", url, undefined, opts);
}

async function ollamaChat(messages, opts = {}) {
  const body = {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    options: {
      temperature: 0,
      // keep responses tight; many models accept num_ctx if supported by ollama model
      num_ctx: 2048,
    },
  };
  const res = await httpPostJson(
    `${OLLAMA_URL.replace(/\/$/, "")}/api/chat`,
    body,
    opts
  );
  const text = String(res?.message?.content || res?.response || "");
  return text;
}

function tryParseJsonStrict(s) {
  // Attempt to extract first top-level JSON object/array
  const str = String(s || "").trim();
  try {
    return JSON.parse(str);
  } catch {}
  const start = str.indexOf("{");
  const end = str.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const sub = str.slice(start, end + 1);
    try {
      return JSON.parse(sub);
    } catch {}
  }
  return null;
}

function normalizeSummary(obj) {
  // Ensure required shape with defaults
  const safeNum = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d);
  const out = {
    version: "1.0",
    bullets: Array.isArray(obj?.bullets)
      ? obj.bullets.filter((x) => typeof x === "string").slice(0, 6)
      : [],
    filesChanged: Array.isArray(obj?.filesChanged)
      ? obj.filesChanged
          .map((f) => ({
            path: String(f?.path || ""),
            adds: safeNum(f?.adds),
            dels: safeNum(f?.dels),
          }))
          .filter((f) => f.path)
      : [],
    tests: {
      passed: safeNum(obj?.tests?.passed),
      failed: safeNum(obj?.tests?.failed),
      failures: Array.isArray(obj?.tests?.failures)
        ? obj.tests.failures
            .map((t) => ({
              name: String(t?.name || ""),
              message: String(t?.message || ""),
            }))
            .filter((t) => t.name || t.message)
        : [],
    },
    errors: Array.isArray(obj?.errors)
      ? obj.errors
          .map((e) => ({
            type: String(e?.type || ""),
            message: String(e?.message || ""),
            file: e?.file ? String(e.file) : undefined,
            line: Number.isFinite(Number(e?.line)) ? Number(e.line) : undefined,
          }))
          .filter((e) => e.type || e.message)
      : [],
    actions: Array.isArray(obj?.actions)
      ? obj.actions
          .map((a) => String(a || ""))
          .filter((a) => a)
          .slice(0, 6)
      : [],
    metrics: {
      durationMs: obj?.metrics?.durationMs
        ? safeNum(obj.metrics.durationMs)
        : undefined,
      commandsRun: obj?.metrics?.commandsRun
        ? safeNum(obj.metrics.commandsRun)
        : undefined,
      exitCode: obj?.metrics?.exitCode
        ? safeNum(obj.metrics.exitCode)
        : undefined,
    },
  };
  return out;
}

export async function summarizeWithLLM(rawText) {
  const input = cutTail(String(rawText || ""), MAX_INPUT_CHARS);
  if (!input.trim()) return { summary: { version: "1.0", bullets: [] } };
  const chunks = toChunks(input, CHUNK_CHARS);
  const started = Date.now();
  dbg("summarizer_llm: chunks", { count: chunks.length, model: OLLAMA_MODEL });

  const mapSummaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    const messages = [
      { role: "system", content: MAP_SYS },
      {
        role: "user",
        content: `${MAP_PROMPT}\n\nCHUNK_INDEX=${i + 1}/${chunks.length}\n\nCHUNK:\n${part}`,
      },
    ];
    try {
      const resText = await ollamaChat(messages);
      const parsed = tryParseJsonStrict(resText);
      if (parsed) {
        mapSummaries.push(normalizeSummary(parsed));
      } else {
        dbg("summarizer_llm: invalid JSON, ignoring map chunk", i + 1);
      }
    } catch (e) {
      dbg("summarizer_llm: map error", i + 1, e?.message || e);
      // continue; best-effort
    }
  }

  if (mapSummaries.length === 0) {
    // Nothing parsed; return empty
    return { summary: { version: "1.0", bullets: [] } };
  }

  let reduced = mapSummaries[0];
  if (mapSummaries.length > 1) {
    try {
      const messages = [
        { role: "system", content: MAP_SYS },
        {
          role: "user",
          content: `${REDUCE_PROMPT}\n\nINPUT_JSON = ${JSON.stringify(mapSummaries)}`,
        },
      ];
      const resText = await ollamaChat(messages, { timeoutMs: TIMEOUT_MS });
      const parsed = tryParseJsonStrict(resText);
      if (parsed) reduced = normalizeSummary(parsed);
    } catch (e) {
      dbg("summarizer_llm: reduce error", e?.message || e);
      // Fallback: naive merge
      reduced = naiveMerge(mapSummaries);
    }
  }

  const durMs = Date.now() - started;
  return {
    summary: reduced,
    metrics: {
      model: OLLAMA_MODEL,
      chunks: chunks.length,
      durationMs: durMs,
      inputHash: simpleHash(input),
    },
  };
}

function naiveMerge(arr) {
  const out = {
    version: "1.0",
    bullets: [],
    filesChanged: [],
    tests: { passed: 0, failed: 0, failures: [] },
    errors: [],
    actions: [],
    metrics: {},
  };
  const seenBullet = new Set();
  const fileMap = new Map();
  const actionSet = new Set();
  for (const s of arr) {
    for (const b of s.bullets || []) {
      if (out.bullets.length < 6 && !seenBullet.has(b)) {
        seenBullet.add(b);
        out.bullets.push(b);
      }
    }
    for (const f of s.filesChanged || []) {
      const key = f.path;
      const prev = fileMap.get(key) || { path: key, adds: 0, dels: 0 };
      prev.adds += Number(f.adds || 0);
      prev.dels += Number(f.dels || 0);
      fileMap.set(key, prev);
    }
    out.tests.passed += Number(s?.tests?.passed || 0);
    out.tests.failed += Number(s?.tests?.failed || 0);
    if (Array.isArray(s?.tests?.failures))
      out.tests.failures.push(...s.tests.failures);
    if (Array.isArray(s?.errors)) out.errors.push(...s.errors);
    for (const a of s.actions || []) actionSet.add(a);
  }
  out.filesChanged = Array.from(fileMap.values());
  out.actions = Array.from(actionSet);
  return out;
}

export async function summarizerHealth() {
  // Probe Ollama tags endpoint to see if server is up and model present
  try {
    const res = await httpGetJson(`${OLLAMA_URL.replace(/\/$/, "")}/api/tags`, {
      timeoutMs: 3000,
    });
    const models = Array.isArray(res?.models) ? res.models : [];
    const hasModel = models.some((m) =>
      String(m?.name || "").includes(OLLAMA_MODEL.split(":")[0])
    );
    return { ok: true, server: true, model: OLLAMA_MODEL, hasModel };
  } catch (e) {
    return {
      ok: false,
      server: false,
      model: OLLAMA_MODEL,
      error: String(e?.message || e),
    };
  }
}
