# Voice Coder – repo tour

A quick map of the monorepo: where things live, key envs, and how the approval flow works.

## Top-level
- bun.lock, package.json, turbo.json — workspace + tasks.
- docs/ — project docs (roadmap in `phases.md`).
- apps/ — backend and app UIs.
- packages/ — shared config (eslint/ts/jest) and a small UI package.

## Backend (apps/backend)
- Entry: `apps/backend/src/server.js`
  - HTTP: `POST /api/prompt` (non-PTY, per-request runner).
  - WebSocket: `/ws` (chat prompts, PTY session, summaries, approvals).
  - Summaries: `apps/backend/src/summarizer.js` (content-hash gated).
  - PTY session: `apps/backend/src/ptySession.js` (node-pty wrapper).
  - Per-request runner: `apps/backend/src/runner.js` (safe spawn, streaming).
- Local env: `apps/backend/.env.local` (auto-loaded by Bun start script)
  - VC_DEBUG=1 — verbose logs.
  - VC_PTY_CMD/VC_PTY_ARGS — PTY agent command, e.g. `node ../agent/bin/agent.js`.
  - VC_APPROVAL_ALWAYS=1 — require approval for any prompt.
  - VC_APPROVAL_TIMEOUT_MS=0 — wait indefinitely for approval (no auto-deny).
  - VC_APPROVAL_PATTERNS — comma/newline list of regex fragments for risky text.
- Approval defaults (examples):
  - `git apply` or lines starting with `diff --git`
  - package installers: `npm|yarn|pnpm install`, `pip|brew|apt|yum|dnf install`
  - network fetches: `curl|wget https?://`
  - destructive ops: `rm -rf`, `chmod`, `chown`, etc.

## Minimal PTY agent (apps/agent)
- `apps/agent/bin/agent.js` — safe, text-only demo agent.
  - Commands: `help`, `remember TEXT`, `recall`, `clear`, `time`,
    `install NAME` (fake), `apply-diff` (fake), `network URL` (fake), `exit|quit`.

## Web app (Next.js) – apps/frontend
- Screen: `apps/frontend/app/page.tsx`
  - Connects to WS, shows PTY panel + summary.
  - Approval modal on `actionRequest` → sends `actionResponse`.
- Env (set via Next public vars):
  - `NEXT_PUBLIC_BACKEND_WS_URL`, `NEXT_PUBLIC_BACKEND_HTTP_URL`

## Native app (Expo) – apps/native
- Screen: `apps/native/app/index.tsx`
  - Connects to WS; same approval/streaming protocol as web.
  - Keyboard auto-dismiss when approval modal opens.
- Env (set via Expo public vars):
  - `EXPO_PUBLIC_BACKEND_WS_URL`, `EXPO_PUBLIC_BACKEND_HTTP_URL`
- Default WS/HTTP host if no env: `192.168.0.100` (adjust for your LAN)

## Protocol (WS messages)
- Client → server:
  - `hello`, `prompt {id,text}`, `startSession {options}`, `interrupt`, `stop`, `resize {cols,rows}`
  - Approvals: `actionResponse {actionId, approve}`
- Server → client:
  - `ack`, `reply`, `replyChunk`, `output` (PTY), `summaryUpdate`, `sessionStarted`, `sessionExit`, `error`
  - Approvals: `actionRequest {actionId, reason, risks[], preview, timeoutMs?}` then `actionResolved {actionId, approved}`

## Approvals 101
- Triggered only for chat prompts (not PTY keystrokes).
- Set `VC_APPROVAL_ALWAYS=1` to require approval for everything.
- To add patterns (e.g. `git diff`): set `VC_APPROVAL_PATTERNS`:
  - Example: `git\s+diff\b, curl https?://, (pnpm|npm|yarn)\s+install\b, diff --git `
  - Note: providing this overrides defaults; include any defaults you still want.

## Typical dev loop
- Backend: run with Bun (loads `.env.local` in `apps/backend/`).
- Point clients to the backend (WS/HTTP URLs) via public envs.
- Send a risky prompt (e.g., `diff --git a/a b/b`, `npm install foo`) → approval modal.

See also: `docs/phases.md` (roadmap + phase notes).
