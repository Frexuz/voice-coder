#!/usr/bin/env node
import { createRequire } from "module";
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
  const path = require("path");
  const dotenv = require("dotenv");
  const envLocal = path.resolve(process.cwd(), ".env.local");
  const envFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envLocal))
    dotenv.config({ path: envLocal, override: true });
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile });
} catch {}

import "./server.js";
