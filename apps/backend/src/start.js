#!/usr/bin/env node
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const require = createRequire(import.meta.url);
try {
  require("express");
  require("ws");
  require("cors");
  require("dotenv");
} catch (err) {
  console.error(
    "\nMissing dependency: run `npm install` in apps/backend`\n",
    err.message
  );
  process.exit(1);
}
// Load environment from .env.local first (override) then .env if present
try {
  const fs = require("fs");
  const dotenv = require("dotenv");
  // Resolve relative to this file's directory to avoid CWD surprises (e.g., Turbo)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const baseDir = here; // apps/backend/src
  const projectDir = path.resolve(baseDir, ".."); // apps/backend
  const envLocal = path.resolve(projectDir, ".env.local");
  const envFile = path.resolve(projectDir, ".env");
  const hadEnvLocal = fs.existsSync(envLocal);
  const hadEnv = fs.existsSync(envFile);
  if (hadEnvLocal) dotenv.config({ path: envLocal, override: true });
  if (hadEnv) dotenv.config({ path: envFile });
  // Always print a concise env summary for debugging engine selection
  try {
    console.log(
      "[vc] env loaded:",
      JSON.stringify(
        {
          cwd: process.cwd(),
          envLocal: hadEnvLocal ? envLocal : null,
          env: hadEnv ? envFile : null,
          VC_SUMMARY_ENGINE: process.env.VC_SUMMARY_ENGINE || null,
          VC_OLLAMA_MODEL: process.env.VC_OLLAMA_MODEL || null,
          VC_OLLAMA_URL: process.env.VC_OLLAMA_URL || null,
        },
        null,
        0
      )
    );
  } catch {}
} catch {}

await import("./server.js");
