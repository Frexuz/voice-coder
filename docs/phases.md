Great plan. Here’s a staged roadmap from PoC to external-tester v1, adding one complexity at a time. Each phase is small, testable, and de-risking a specific subsystem.

[x] Phase 0 — PoC (done/doing)
- Goal: Local-only, say “hello” → get “you said ‘hello’.”
- Stack: Next.js + local Node WS server + stub agent.
- Scope: Press-to-talk, local STT (Web Speech), WS round-trip, simple UI.

[x] Phase 1 — Real CLI integration (per-request spawn)
- Goal: Replace stub with a real CLI command run per request.
- Add:
  - Child process spawn per request; capture stdout/stderr; timeout/kill on overrun.
  - Basic sanitization and size limits on input/output.
  - Simple error mapping to user-friendly messages.
  - Implemented via `apps/backend/src/runner.js`; configurable with env: VC_CMD, VC_ARGS, VC_TIMEOUT_MS, VC_MAX_*.
- Test cases:
  - Short prompts, long prompts, CLI exits non-zero, timeouts.
- Risks addressed: executing tools safely, safe output handling.

[x] Phase 2 — Persistent CLI session (PTY)
- Goal: Maintain a live interactive session for stateful tools.
- Add:
  - PTY integration (node-pty) with a single long-lived process.
  - IMPORTANT: Configure PTY to run a stateful agent (via VC_PTY_CMD/VC_PTY_ARGS) rather than a plain shell if you want prompts treated as natural language. If you point PTY at your login shell, spoken/typed prompts will be executed as shell commands.
  - Optional built-in agent: provide a minimal Node.js agent (apps/agent) that keeps simple in-memory context and reads stdin → writes stdout. This lets PTY be useful immediately without external tools.
    - Wiring example (from apps/backend): VC_PTY_CMD="node", VC_PTY_ARGS="../agent/bin/agent.js".
    - Scope: safe by default (no exec), basic commands (help/clear/exit), and a place to prototype approvals later.
  - WS message types:
    - Client → Server: `startSession { options? }`, `prompt { id?, text }`, `interrupt`, `reset`, `stop`.
    - Server → Client: `sessionStarted { ok, cfg, running }`, `output { data }` (streaming), `sessionExit { info }`, `ack { id }`, `reply { id, text }`, `error { id?, error, message, preview? }`.
  - Backpressure and output ring buffer (e.g., last 5–10k lines).
- Test cases:
  - Multi-step interactions, interrupts (Ctrl-C), restarts.
- Risks addressed: interactive control, process lifecycle, memory bounds.

[x] Phase 3 — Simple summarization (cloud-free)
- Goal: Don’t flood UI; show concise bullets.
- Add:
  - Local map-only summarization using basic chunking + deterministic rules OR a tiny local model if available.
  - Scope note: Summarization is output-only; it does not change routing or input semantics. Whatever the PTY/runner outputs is summarized.
  - UI splits “Raw log” vs “Summary.”
  - WS events: replyChunk + summaryUpdate.
  - Implemented: backend emits summaryUpdate on buffer changes and streams non-PTY output via replyChunk; UI shows Summary vs Raw log.
- Minimal approach:
  - For now, just cap and truncate raw lines; synthesize 3–5 bullets via template rules (errors, files, durations) extracted by regex where obvious.
- Risks addressed: user experience under noisy output.

[x] Phase 4 — Approvals and safe actions
- Goal: Human-in-the-loop for risky steps.
- Add:
  - Protocol for actionRequest/actionResponse (approve/deny).
  - Pre-configured “risky” markers (apply diff, run shell with network, install deps).
  - UI modals with clear Approve/Deny.
- Test cases:
  - Deny path halts correctly; approve path proceeds; timeouts auto-deny.
- Risks addressed: safety, trust.

[ ] Phase 5 — Local summarizer model (map-reduce)
- Goal: Quality summaries without cloud.
- Add:
  - Ollama or llama.cpp with a 3B–7B quantized model (Qwen2.5-3B Q4 or Mistral 7B Q4).
  - Chunked map → periodic reduce; output JSON with bullets/files/tests/errors.
  - UI renders JSON schema.
- Operational:
  - Download/initialize model on first run; healthcheck; telemetry: tokens, latency.
- Risks addressed: model packaging, latency on average hardware.

[ ] Phase 6 — On-demand expansion (slices)
- Goal: Keep bandwidth tiny; fetch details only when asked.
- Add:
  - Slice requests: expandRequest(type, params) → expandResponse (diff for file, first failing test, last error stack).
  - Adapter stores raw output locally (rolling window) and returns only requested slices.
- UI:
  - Chips/buttons under summary: “View diff,” “Show first failure,” “Show last error.”
- Risks addressed: scalable UX for big outputs, privacy.

[ ] Phase 7 — Basic control plane (single-tenant dev hosting)
- Goal: Run from anywhere on your LAN or via a stable URL for you.
- Add:
  - Separate backend service process from Next.js, still single-tenant.
  - Auth-lite: shared secret or device code to pair phone ↔ adapter.
  - Device registry in a simple SQLite/Postgres file.
  - HTTPS via local reverse proxy (Caddy/Traefik) + self-signed or dev CA.
- Risks addressed: multi-device awareness, basic auth, HTTPS/mic on iOS.

[ ] Phase 8 — Cloud polish (optional, on-demand)
- Goal: Better summaries when requested; keep costs negligible.
- Add:
  - Server-side call to a “mini” model (e.g., GPT-4o-mini/Haiku/Flash) only on user tap “Polish.”
  - Strict token caps and redactors for code/privacy if used.
- UI:
  - “Polish with cloud” button and visible token counter.
- Risks addressed: model variability, cost control.

[ ] Phase 9 — Profiles for 1–2 target agents
- Goal: Smooth integrations with 1–2 popular CLIs (e.g., Aider, Open Interpreter).
- Add:
  - Per-agent profile: start command, env, ready signal, completion heuristics, capabilities flags.
  - Profiles formalize PTY startup (VC_PTY_CMD/ARGS) and clarify input semantics so prompts are interpreted by the agent, not a bare shell.
  - PTY quirks fixed per agent; restart policy.
- Risks addressed: variance in agent behavior.

[ ] Phase 10 — Minimal multi-user, remote access (alpha)
- Goal: Share with a couple of teammates.
- Add:
  - Hosted control plane (small VPS): WS gateway + Postgres + Redis.
  - Auth: email magic link or GitHub OAuth; per-user API keys for adapters.
  - Outbound-only adapters; pair devices to users; session routing.
- Security:
  - No raw logs stored server-side; summaries only by default.
- Risks addressed: user management, routing, small-scale reliability.

[ ] Phase 11 — Telemetry, quotas, and stability hardening
- Goal: Prepare for external testers.
- Add:
  - Metrics: latency, errors, token usage, model health.
  - Quotas/rate limits; safe defaults per user/org.
  - Better error surfaces and retry/backoff.
  - Crash recovery: adapter auto-restart; session resume.
- Risks addressed: operability, runaway costs.

[ ] Phase 12 — v1 for external testers (beta)
- Deliverables:
  - Hosted web app with login.
  - Downloadable adapter for macOS/Windows/Linux with simple installer.
  - At least one agent profile fully working end-to-end with approvals and summaries.
  - Privacy modes: local-only vs cloud-polish opt-in.
  - Docs: quickstart, security notes, troubleshooting.
- Acceptance:
  - A new tester can install, pair device, speak a command, review a diff, approve apply, and see a concise summary—all within ~10 minutes.

Per-phase guardrails
- Keep one new complexity per phase.
- Preserve LAN-only privacy until Phase 10.
- Always maintain a working fallback path (typed input, POST fallback, local-only mode).
- Add observability as you go: simple console logs → structured logs → metrics.

If you want, I can attach phase-by-phase checklists and minimal success tests you can copy into issues.
