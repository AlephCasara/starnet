# Product scope decisions (post-gate review)

Where each original product requirement landed after the 12 gates. Reuse-first:
if upstream v0.13.3 already provides the seam, we use it and add no parallel
mechanism.

## Browser UI + the same station

PASSIVE (no code needed). The station serves the browser UI and the desktop from
the same loopback port; the desktop attach mode consumes the identical bootstrap
contract (`GET /` + `window.__STARNET_API_TOKEN__`). `test/external-attach.e2e.mjs`
proves health, token discovery, auth and survival for an external client; the
browser is one more such client. Remote browser/debug strategy is documented in
`docs/REMOTE_ACCESS.md` (SSH local forward for the same user; tailnet serve for
read-only sharing; peer ownership stays authoritative).

## Provider architecture

UPSTREAM SEAM SUFFICES. `sidecar/providers/registry.js` already models
OpenAI-compatible (`custom`/`openai-compatible` with `CUSTOM_OPENAI_BASE_URL`),
Anthropic, Gemini, Codex/ChatGPT OAuth, `claude-cli` (spawns the local Claude
Code CLI), `ollama`, and a dozen hosted providers, with per-agent
provider/model in the roster and env/keychain key resolution. Downstream adds no
registry. The Nix module's non-secret `environment` option plus the optional
Hermes OpenAI-compatible proxy (`exposeAsCustomProvider`) are the only wiring,
with the documented limitation that `custom` is a single slot: a local inference
router and the Hermes proxy cannot both claim it; the module keeps the slot for
the host's choice and leaves the other to in-station configuration.

## Voice provider seam

UPSTREAM SEAM SUFFICES FOR NOW. The sidecar carries an offline voice stack
(Transformers ASR, Kokoro TTS, EdgeTTS remote TTS, native STT) with the Linux
ABI isolation patch keeping the two ONNX runtimes loadable in one process
(`test/voice-abi-dynamic.mjs`). An additional injectable external speech
provider would be a new abstraction; nothing downstream needs it yet. The
ledger keeps `external-speech-provider` as a reserved patch name; implement only
when a concrete provider cannot ride the existing config.

## StationSpec / declarative reconciliation

DECISION: WAIT (documented, not implemented). Reasons:

1. station state in v0.13.3 is PAGE state: rooms, layout and placements live in
   the browser's `agent.save.json` and the routing plan; there is no
   `station.plan`/`station.build` server primitive to reconcile against, only
   per-action mutation routes and the session verbs;
2. a correct partial-desired-state layer (ownership metadata, plan/diff/apply,
   idempotence, no-delete-by-absence) on top of per-action routes would be a
   framework, not a patch, violating the small-removable-delta rule;
3. the pieces that DO need declarative shape today (one canonical runtime,
   port, workspace policy, provider env, desktop attach) are already covered by
   the Home Manager module without owning mutable state.

Re-evaluate on the next upstream release: if a server-side station mutation API
with stable ids appears, a thin spec layer becomes a candidate.

## External system adapters

NO ADAPTER CODE IN THIS REPO. StarNet's native seams already cover every
required system; a repo-side adapter layer would duplicate them:

| system | native seam | boundary |
|---|---|---|
| FlowWink | MCP connector (streamable HTTP, `POST /api/connectors`) | business state/actions live in FlowWink; StarNet only calls skills |
| win | CLI (JSON `inspect`), or any shell tool | loop definitions only; StarNet stays the wake authority |
| Business Master | CLI via workbench tool | economic decisions; no operational authority |
| OpenMAO | CLI (or its loopback HTTP API) | governance/approvals for consequential actions |
| RAGFlow | HTTP API via `web_request`/custom tools, or MCP | durable retrieval, read-mostly |
| SurfSense | HTTP API / MCP | live research source |
| ComfyUI | HTTP API / MCP | media generation |

Each integration needs only non-secret connector configuration (URL, groups)
which the operator sets through the station UI or `POST /api/connectors`; the
Nix module passes provider endpoints without secrets. Ninja is explicitly out
of scope for this fork. Business workflows, campaigns, leads and payments are
not configured by anything in this repository.
