Product Requirements Document (PRD)
Project: Mobile-first control of local coding agents via central SaaS + adapter
Owner: You
Version: v1.0
Status: Draft for review

1. Overview
- Problem: Developers want to drive local code agents (Aider, Open Interpreter, Auggie CLI, Claude CODE, Gemini CLI, etc.) from a phone. Raw agent output is too verbose for mobile. Tools vary widely; some are CLIs, some are IDE plugins.
- Solution: A central SaaS control plane routes messages between a mobile PWA and a lightweight local adapter. The adapter spawns and manages a chosen agent CLI in a PTY (or uses a server/API mode when available). Output is summarized for mobile using a local “mini” LLM with optional cloud polish. Privacy and approvals are first-class.
- Goals:
  - Vendor-neutral support for multiple CLI agents.
  - Great mobile UX with concise summaries and on-demand expansion.
  - Strong privacy: outbound-only connections; local summarization by default.
  - Operable at scale; predictable costs (STT biggest variable).

2. Personas and Use Cases
- Solo dev on laptop:
  - Start agent profile (e.g., Aider) and talk to it from phone. Review diffs, approve apply, run tests, get concise summaries.
- Team developer:
  - Use org policy, SSO, and quotas. Share device profiles. Approve risky edits via phone during a commute.
- Enterprise engineer:
  - “Local-only” mode: no raw code leaves machine; only structured summaries/metadata sent to SaaS.

3. Scope and Non-Goals
- In scope:
  - Adapter that spawns/controls CLI agents via PTY or API.
  - Central WebSocket router and session management.
  - PWA with push-to-talk, streaming text, and concise summaries.
  - Summarization pipeline (local mini-model + optional cloud polish).
  - Git guardrails (auto-commit, revert, approvals).
  - Initial profiles: Aider, Open Interpreter, Auggie CLI, Claude CODE, Gemini CLI; generic chat CLI.
- Out of scope (v1):
  - IDE-only integrations without CLI/API (e.g., editor plugins controlled via UI).
  - Direct control of Warp AI features (Warp can be used as a terminal only).
  - Server-mixed TTS streaming (use on-device TTS first).

4. System Architecture
- Components:
  - Mobile PWA: push-to-talk, live partial transcripts, render summaries, approve/deny actions, on-demand expansion.
  - SaaS Control Plane:
    - WebSocket Gateway: terminates client and adapter connections.
    - Router/Orchestrator: routes messages by session; enforces auth, quotas, and policy.
    - Pub/Sub Backplane: Redis or NATS for fanout.
    - Database: Postgres for users, orgs, devices, sessions, policies, tokens.
    - Optional Cloud Summarizer: small, cost-effective model for “polish/explain on demand.”
  - Local Adapter (user machine):
    - Maintains outbound WebSocket to SaaS.
    - Spawns the chosen agent in a PTY (or connects to server/API mode if available).
    - Streams stdin/stdout; enforces approvals and git guardrails.
    - Runs local summarizer (quantized 3–8B model) using chunked map-reduce.
    - Stores raw logs locally; serves on-demand slices.

- Connectivity:
  - Outbound-only connections from adapter; no inbound ports or tunnels by default.
  - Both phone and adapter connect to SaaS via WebSocket; SaaS routes messages.

5. Session Lifecycle
- Device registration:
  - User installs adapter; logs in; device gets a key and registers capabilities.
- Start session:
  - Phone opens PWA and selects device + agent profile; SaaS creates sessionId.
  - SaaS notifies adapter; adapter spawns agent per profile, waits for “ready.”
- Messaging:
  - Phone sends text (or voice→STT text) with msgId; SaaS routes to adapter.
  - Adapter writes prompt to agent stdin (PTY) or sends API request if server mode.
  - Agent output streams back; adapter performs local chunked summarization; streams headline updates and optional structured JSON to SaaS.
- Approvals:
  - When risky actions or diffs are proposed, adapter pauses; PWA shows summary/diff; user Approve/Deny.
  - On Approve, adapter applies diff or forwards “apply” command to agent; commits with message.
- Stop/Reset:
  - User can stop (SIGINT) or reset (restart process). Adapter ensures clean teardown.
- End session:
  - Adapter stops agent; sends summary; session closed in SaaS.

6. Data Model and Message Envelope
- Envelope (JSON over WebSocket), all messages:
  - {type, sessionId, msgId, role, content, meta, chunks, done, ts}
  - type: prompt | stream | summary | approvalRequest | approvalResponse | control | error | expandRequest | expandResponse
  - role: user | agent | system | adapter
  - content: text payload for prompts/streams; or structured JSON for summaries.
  - meta: {agentId, profileId, deviceId, tokens, model, cost, partIndex, totalParts}
  - chunks/done: for streaming partials.

- Summary schema (adapter-produced, validated JSON):
  - {
      version: "1.0",
      bullets: [string],
      filesChanged: [{path, adds, dels}],
      tests: {passed, failed, failures: [{name, message}]],
      errors: [{type, message, file?, line?}],
      actions: [ "apply", "rerun", "open_pr", ... ],
      metrics: {durationMs, commandsRun, exitCode?}
    }

7. Agent Integration
- Integration tiers:
  - Tier A: Native API/Server mode (preferred when available).
  - Tier B: PTY-based stdin/stdout CLI control (default).
  - Tier C: Chat-only CLI; adapter acts as executor for edits/commands if enabled.
- Profiles (per-agent config, remote-updatable):
  - {
      name, cmd, args, env,
      ready: {promptRegex?, apiHealth?},
      completion: {promptRegex?, silenceMs?, timeoutMs},
      supports: {proposeDiff, applyDiff, runShell, jsonMode, serverMode},
      parse: {diff: {type, startRegex, endRegex}, plan?: {...}},
      policies: {requireApprovalFor: ["applyDiff","runShell","network"], gitRequired: true}
    }
- Target agents (v1):
  - Aider: PTY; supports diffs and apply. Good ready/complete prompts.
  - Open Interpreter: PTY; runs shell, edits files; approvals enforced by adapter.
  - Auggie CLI: PTY; treat like interactive; look for any dry-run/JSON flags.
  - Claude CODE (CLI): PTY; observe ToS; likely chat + actions.
  - Gemini CLI (official): PTY; chat-first; use adapter executor if edits are needed.
  - Generic chat CLI: minimal profile; chat only.

8. Summarization
- Strategy: model-in-the-middle, chunked map-reduce; no brittle agent-specific heuristics.
- Map step:
  - As output streams, tokenize into ~1–2k-token chunks.
  - For each chunk, call local mini-model with prompt: “Summarize into 5 bullets + schema; do not assume context.”
- Reduce step:
  - Combine N chunk summaries or when requested by user into a concise overall summary conforming to the summary schema.
- Local by default:
  - Run a quantized 3–8B model via Ollama or llama.cpp.
  - Recommended defaults:
    - Qwen2.5-3B Instruct Q4: ~1–2 GB download, ~3–4 GB RAM, fast.
    - Mistral 7B Instruct Q4: ~3–4 GB download, ~5–7 GB RAM.
    - Llama 3.1 8B Instruct Q4: ~4.5–5.5 GB download, ~6–8 GB RAM.
- Cloud polish (optional, on-demand):
  - gpt-4o-mini / o3-mini, Gemini Flash, or Claude Haiku.
  - Only send chunk summaries or structured artifacts by default; raw logs stay local unless user explicitly expands.
- Config without redeploy:
  - Model aliases and prompts come from remote config; adapter fetches at start.
  - Versioned schema; accept current and N-1.

9. Voice (STT/TTS)
- STT:
  - MVP: provider-hosted streaming STT (OpenAI Realtime/Whisper, Deepgram, AssemblyAI).
  - Push-to-talk UX to control cost; partial transcripts within 100–400 ms.
- TTS:
  - Default: on-device SpeechSynthesis API (iOS/Android/desktop browsers).
  - Server TTS later if requested by users.

10. Mobile UX Requirements
- Show concise 3–6 bullets headline summary with chips:
  - Files (count, +adds/−dels), Tests (pass/fail), Errors (count), Duration.
- Live streaming status with minimal noise.
- Approvals:
  - Approve/Deny for apply diff, run shell, network access.
  - Show diffs in collapsible view; cap to first 100 lines with “expand.”
- Expansion on demand:
  - “Show diff for file X,” “Show first failing test,” “Show latest error.”
  - Requests go adapter→serve precise slice; avoid sending full logs to SaaS.
- Controls:
  - Stop (SIGINT), Reset (restart agent), Panic Revert (git restore to last clean commit).
- Settings:
  - Privacy mode: local-only summarization; no raw logs to cloud.
  - Summarizer choice: local alias vs cloud mini.
  - Token/usage meters and org caps.

11. Security, Privacy, and Policy
- Outbound-only connections from adapter; no inbound ports.
- Local-only privacy mode: no raw code/logs to SaaS; only structured summaries/metadata.
- Secrets remain local; support BYO keys (Anthropic, OpenAI, Google) in adapter config.
- Approvals enforced in adapter; deny by default for risky operations if no response.
- Audit metadata: minimal text by default; full content logging opt-in per org.
- Kill switch: remotely disable a device/session; adapter honors revoke tokens.
- ToS/compliance: verify third-party CLI ToS for automated control.

12. Reliability and Observability
- Health checks:
  - Adapter heartbeats; agent process liveness; ready prompt detection.
- Error handling:
  - Timeouts per request; retry with shortened context; reset on stalled PTY.
- Metrics:
  - Latency, token usage (STT, LLM), summary success rates, false-complete rate, stop/resets, approval response times.
- Logs:
  - Structured event logs in SaaS; raw logs local-only unless opted-in.
- Cross-platform:
  - PTY support: node-pty (Node) or creack/pty (Go); ConPTY on Windows; WSL guidance.

13. Scalability and Sizing
- WebSockets:
  - 2–4 vCPU nodes can handle 1–2k active streams or 10k+ idle conns each.
  - Use LB → WS gateway → Redis/NATS backplane → workers.
- Backend:
  - Postgres small/medium for auth/metadata.
  - Redis/NATS primary + replica.
- Cost drivers:
  - STT biggest variable; summarization cheap if local and modest if cloud mini.
  - Bandwidth controlled by summaries + on-demand slices.

14. Configuration and Profiles
- Remote-managed JSON/YAML profiles for agents:
  - Start commands, env, prompts/regexes, capabilities, policies.
- Feature flags:
  - Enable/disable cloud polish, privacy mode defaults, per-org quotas.
- Updatable without redeploy; adapter fetches config on start and with backoff polling.

15. MVP Scope
- Core:
  - Adapter (Node or Go), PTY control, WS client, approvals, git guardrails.
  - SaaS WS gateway + router + Postgres + Redis.
  - PWA with push-to-talk, streaming, summary view, approvals, expand-on-demand.
  - Summarizer: local Qwen2.5-3B Q4 via Ollama; cloud polish toggle.
  - Profiles: Aider, Open Interpreter, Generic Chat CLI.
- Nice-to-have for MVP+:
  - Auggie CLI, Claude CODE, Gemini CLI profiles.
  - Local privacy mode toggle and org policies UI.
  - Panic revert button in PWA.

16. Risks and Mitigations
- Diverse agent behaviors:
  - Mitigate with per-agent profiles; prefer server/API mode when available; provide generic PTY fallback.
- Summarization quality variability:
  - Use chunked map-reduce; allow cloud polish on demand; telemetry to tune prompts.
- Windows PTY quirks:
  - Test with ConPTY and WSL; ship known-good configs.
- Cost overruns (STT/LLM):
  - PTT UX; quotas; token caps; local summarization default.
- Legal/ToS:
  - Maintain a matrix of allowed automated control; provide “custom command” at user risk.

17. Open Questions
- Which language for adapter (Go vs Node) and for WS gateway?
- Which STT provider for MVP?
- Which two agents to focus on first for deep integration?
- Org features needed for initial customers (SSO, audit export)?
- Do we need E2E encryption for summaries in privacy-sensitive orgs?

18. Roadmap (high-level)
- Week 1–2:
  - Define message schema; implement WS gateway and minimal router.
  - Adapter PTY spawn + stream; Aider profile; Git guardrails; Stop/Reset.
  - PWA PTT and text streaming; basic summary rendering.
- Week 3–4:
  - Local summarizer (Ollama + Qwen2.5-3B Q4); chunked map-reduce; JSON schema.
  - Approval flows; diff render; expand-on-demand slices.
  - Add Open Interpreter profile and generic chat CLI.
- Week 5–6:
  - Cloud polish option; org policies; quotas; telemetry dashboards.
  - Add Auggie CLI and Gemini CLI profiles; begin Claude CODE profile.
  - Harden cross-platform; privacy mode; panic revert.
- Week 7+:
  - API/server-mode integrations if agents expose them.
  - Enterprise features (SSO, audit, device posture checks).
  - Optional server TTS; richer summaries (traces, benchmarks).

19. Acceptance Criteria (MVP)
- User can from phone:
  - Connect to a registered device and start an agent session.
  - Speak or type a prompt; see live status; receive a concise summary (<6 bullets).
  - Tap to view a specific diff or first failing test without downloading full logs.
  - Approve or deny “apply diff” and “run shell” actions.
  - Stop/reset the agent; panic revert to last clean commit.
- Adapter:
  - Spawns agent reliably; detects ready; handles SIGINT; restarts cleanly.
  - Produces valid JSON summaries for streams up to at least 100k tokens via chunked map-reduce.
  - Keeps raw logs local; serves slices on demand.
- SaaS:
  - Routes messages, enforces auth and per-org quotas.
  - Stores minimal metadata; no raw code unless opted-in.
  - Handles 500 concurrent active sessions on modest infra.

20. Appendix: Default Prompts (high-level)
- Map prompt (chunk):
  - “You are compressing arbitrary developer tool output. Produce JSON with fields: bullets (<=5), filesChanged (path, adds, dels), tests (passed, failed, failures[name,message]), errors (type,message,file?,line?), actions (from: apply, rerun, open_pr, fix_tests), metrics (durationMs?). Do not assume other chunks; only summarize this chunk. Output JSON only.”
- Reduce prompt (combine):
  - “Given N JSON chunk-summaries, produce a single consolidated JSON summary with the same schema. Merge duplicates, keep totals consistent, prioritize failures and risky files. Output JSON only.”

If you want, I can tailor this PRD to your preferred stack (Go vs Node), pick concrete libraries, and generate initial code skeletons and config templates.
