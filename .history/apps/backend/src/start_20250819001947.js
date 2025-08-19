#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
try {
  require('express');
  require('ws');
  require('cors');
} catch (err) {
  console.error('\nMissing dependency: run `npm install` in apps/backend`\n', err.message);
  process.exit(1);
}

import './server.js';
