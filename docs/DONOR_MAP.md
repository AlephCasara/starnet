# StarNet donor map — features worth reusing without adopting stale forks

This file records external/upstream lanes that were inspected while building the NixOS/Hermes integration. The rule is **current upstream first, selective port second, wholesale fork merge last**.

## Current upstream — authoritative base

Base: `androoAGI/starnet:feat/harness-backend`
Baseline inspected: `54899e5ff3f2b002b457757916b3977818db6fc1`

Already present — do not re-port:

- `claude-cli` provider: local Claude Code as a StarNet brain, with StarNet retaining tool execution/consent ownership.
- Hermes/OpenClaw profile import via `sidecar/harness-import.js`.
- Generic OpenAI-compatible `custom` provider.
- Linux/XDG-aware sidecar and terminal CLI.
- ACP and `/v1` surfaces.

This remains the merge/rebase source for `AlephCasara/starnet`.

## `acbrazzl/starnet:feat/claude-code-crew`

Useful donor concepts:

- Projection of already-running Claude Code CLI sessions as visible floor crew.
- Start/stop/background session UX.
- Mobile/PWA surface and exact-host remote access patterns.
- Historical Linux validation of Claude CLI integration.

Do **not** merge wholesale:

- Its Claude model-provider work has largely been superseded by current upstream `claude-cli`.
- The branch was built from an older StarNet tree and touches provider, frontend, auth, overseer and remote-access code together.

Potential future lane: cherry-pick/reimplement only session projection and phone/PWA UX after the base NixOS deployment is stable.

## `androoAGI/starnet:agent/cortex-hermes-plus`

This is an old, highly diverged upstream research branch. It is thousands of commits behind the current harness branch.

Interesting donor ideas/files:

- `sidecar/memoryprovider.js`
- `sidecar/notebookstore.js`
- `sidecar/reviewqueue.js`
- recall/notebook/skill-store improvements
- Hermes-inspired memory/notebook semantics

Do **not** use as a merge base. Any idea worth reviving must be re-evaluated against current StarNet memory, skill and safety contracts first.

## Hermes Agent upstream — preferred integration boundary

Repository: `NousResearch/hermes-agent`

Current reusable surfaces:

- `hermes proxy` — local OpenAI-compatible inference proxy backed by Hermes-owned OAuth credentials.
- `hermes --oneshot` / `hermes chat --query` — potential future CLI adapter seam.
- `hermes acp` — potential future structured agent bridge.
- `hermes mcp serve` — exposes Hermes capabilities to MCP clients.
- profiles, model routing, fallbacks and credential pools remain owned by Hermes.

**Current choice:** use `hermes proxy` first. This lets StarNet consume Hermes/Nous models while StarNet remains the sole owner of its tool loop and consent system.

A deeper `hermes-cli` StarNet provider should only be added if proxy-based model access is insufficient. It must define exactly which harness owns tools, sessions, memory, cancellation and usage accounting.

## Current upstream issues relevant to this workstation

These are not donor branches, but they change what should be trusted during validation:

- **#105 — Claude CLI overhead:** current `claude-cli` can carry a very large tool/prompt prefix and auxiliary passes. Useful later for token-budget tuning, especially when GLM/Claude CLI is used heavily.
- **#102 — Qwen3.8/Ollama system-message ordering:** local OpenAI-compatible models may have chat-template constraints. Validate the exact local model before treating generic compatibility as universal.
- **#96 — `/v1` and ACP tool advertisement:** external programmatic surfaces had a report where tools were not advertised because the task flag was absent. Re-check before using ACP or `/v1` as the Hermes live-agent bridge.
- **#89 — Linux unattended-provider credentials:** scheduled/unattended provider resolution has had Linux-specific reports. Interactive success is not sufficient proof for autonomous routines.

## Integration order

1. Nix-native StarNet sidecar and browser UI.
2. Hermes models through `hermes proxy`.
3. Current upstream `claude-cli` through the existing managed Claude Code/Z.ai policy.
4. Local OpenAI-compatible model endpoints.
5. Only after those are stable: Claude session projection / PWA remote UX from `acbrazzl`.
6. Only if it materially improves capability: Hermes live-agent/ACP integration.
7. Memory/notebook ideas from `cortex-hermes-plus` are independent experiments, not prerequisites.

This ordering minimizes fork drift and leaves the local coding agent with host validation rather than architecture research.
