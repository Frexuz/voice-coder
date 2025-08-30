// Engine selector for summarization: heuristic (Phase 3) vs LLM (Phase 5)
import { summarize as heuristicSummarize } from "./summarizer.js";
import {
  summarizeWithLLM,
  summarizerHealth as llmHealth,
} from "./summarizer_llm.js";

function currentEngine() {
  return (process.env.VC_SUMMARY_ENGINE || "heuristic").toLowerCase();
}
const DEBUG =
  String(process.env.VC_DEBUG || "").toLowerCase() === "true" ||
  process.env.VC_DEBUG === "1";
const dbg = (...args) => {
  if (DEBUG) console.log("[vc-debug]", ...args);
};

function simpleHash(s) {
  let h = 0;
  for (let i = Math.max(0, s.length - 5000); i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function wrapHeuristicToSchema(h) {
  return {
    version: "1.0",
    bullets: Array.isArray(h?.bullets) ? h.bullets : [],
    filesChanged: [],
    tests: { passed: 0, failed: 0, failures: [] },
    errors: [],
    actions: [],
    metrics: {},
  };
}

export async function summarizeEngine(rawText) {
  const text = String(rawText || "");
  const ENGINE = currentEngine();
  if (ENGINE === "llm" || ENGINE === "ollama" || ENGINE === "model") {
    try {
      const r = await summarizeWithLLM(text);
      if (r && r.summary) return r.summary;
    } catch (e) {
      dbg("summarizer_engine: llm failed, falling back", e?.message || e);
    }
  }
  // fallback to heuristic
  return wrapHeuristicToSchema(heuristicSummarize(text));
}

export async function summarizeIfChanged(text, lastHash) {
  const s = String(text || "");
  const hash = simpleHash(s);
  if (hash === lastHash) return { changed: false, hash, summary: null };
  const summary = await summarizeEngine(s);
  return { changed: true, hash, summary };
}

export async function summarizerHealth() {
  const ENGINE = currentEngine();
  if (ENGINE === "llm" || ENGINE === "ollama" || ENGINE === "model") {
    try {
      const h = await llmHealth();
      return {
        engine: "llm",
        engineEnv: process.env.VC_SUMMARY_ENGINE || null,
        ...h,
      };
    } catch (e) {
      return {
        engine: "llm",
        engineEnv: process.env.VC_SUMMARY_ENGINE || null,
        ok: false,
        error: String(e?.message || e),
      };
    }
  }
  return {
    engine: "heuristic",
    engineEnv: process.env.VC_SUMMARY_ENGINE || null,
    ok: true,
  };
}

export function summarizerEngine() {
  const e = currentEngine();
  dbg("summarizerEngine()", {
    resolved: e,
    env: process.env.VC_SUMMARY_ENGINE || null,
  });
  return e;
}
