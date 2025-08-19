# vc-agent (minimal)

A tiny, safe-by-default, stateful Node.js CLI designed to run under the PTY in this repo.

Features
- Keeps simple in-memory context (notes, history)
- Reads stdin, writes stdout; suitable for long-lived sessions
- Commands: help, remember, recall, clear, time, exit/quit
- No shell execution; deterministic behavior

Run locally
```
npm run start --workspace @root/apps/agent
# or: node apps/agent/bin/agent.js
```

Wire to PTY (backend)
- In a shell before starting backend:
```
export VC_PTY_CMD="node"
export VC_PTY_ARGS="../agent/bin/agent.js"
```
- Then start backend and click "Start" in the UI. Prompts will go to this agent.

Notes
- This is a placeholder agent to test PTY + UX without external dependencies.
- You can extend it to add approvals, summaries, or connect to a local LLM later.
