# NixOS downstream roadmap

Status: implementation contract for `integration/nixos-starnet-foundation`.

This downstream exists to run current StarNet well on Aleph's NixOS/Hyprland workstation while keeping the product code close enough to upstream that local patches can be deleted when upstream grows equivalent behavior.

## Non-negotiable architecture

- `androoAGI/starnet` remains the product upstream and preferred implementation whenever it already solves the problem.
- One canonical StarNet sidecar owns one workspace. On Aleph's host it is persistent and owned by `systemd --user`, not by a browser tab.
- Tauri/WebKit is the primary local UI. Browser UI remains available against the same station for remote development/debug access.
- The sidecar remains loopback-only. Remote browser access is through an authenticated SSH/Tailscale tunnel, never a public `:8787` listener.
- Nix owns software/runtime composition, service lifecycle, dependencies, immutable defaults and desired topology inputs. StarNet owns mutable station state. A Nix rebuild must never recreate or reset the station.
- Secrets and mutable workspaces never enter the Nix store or git.
- StarNet remains the sole meta-orchestrator.
- Ninja is not part of this integration.
- Commercial/business workflows are explicitly out of scope here; this branch only builds the generic integration surfaces they will later use.

## Upstreams and references

Use four git remotes in engineering work:

- `upstream`: `androoAGI/starnet` — canonical product/runtime.
- `origin`: `AlephCasara/starnet` — this downstream.
- `linux`: `mvalancy/starnet-linux` — Linux implementation/test reference, not merge base.
- `pauli`: `executiveusa/pauli-starnet` — declarative-organization and operating-pattern reference, not merge base.

Never wholesale-merge the Linux or Pauli forks. Compare subsystem-by-subsystem against the current upstream and port only a still-missing behavior. Prefer a fresh implementation against current upstream seams when the old patch overlaps later upstream work.

Third-party transcript corpora, verbatim commercial scripts and other source material in downstream forks are not StarNet implementation code and must not be copied into this generic fork.

## Patch retirement rule

Every downstream product patch must have:

1. one generic capability/bug it supplies;
2. focused tests proving the behavior;
3. no Aleph-specific business topology or credentials;
4. a note naming the upstream seam it extends;
5. a deletion condition: when upstream provides equivalent behavior and tests pass without the patch, remove it.

Prefer small upstreamable changes. Large local compositions belong in Nix, plugins or adapters rather than in StarNet core.

## Authority map

The integrated runtime must keep one source of truth per concern:

| Concern | Authority |
| --- | --- |
| agent/meta orchestration, station capabilities, UI, schedules | StarNet |
| transactional business/CRM/commerce/accounting state | FlowWink |
| procedural business loop contracts and journals | win |
| organizational policy/approval/audit gate | OpenMAO integration surface |
| experiment evidence, economic evaluation, portfolio/capital decisions | Business Master |
| durable retrieval/knowledge | RAGFlow |
| live research/retrieval | SurfSense |
| media generation | ComfyUI |
| local inference routing | existing llama-swap/custom OpenAI-compatible endpoint |

An adapter may reference another system's state but must not silently become a second owner for it.

### Important OpenMAO boundary

OpenMAO's own upstream aspires to own an organization's work lifecycle/control spine. That conflicts with this deployment's requirement that StarNet remain the sole meta-orchestrator. Initial integration therefore uses OpenMAO only for the enforceable governance subset: policy, durable approval, capability gating and audit. Do not hand it StarNet scheduling or general work orchestration in this phase.

### Pauli-derived ideas we keep

Do not copy the old CityOS planner wholesale; current StarNet already owns physical planning/build validation.

Keep the useful semantic layer instead:

- declarative organizational intent above physical coordinates;
- room/building = capability boundary, not decoration;
- `Defined != active != connected != healthy != verified outcome`;
- persistent operators vs bounded mission workers;
- least-privilege execution ladder: connector/API/MCP before shell, browser, desktop or vision;
- bounded experiments use `propose -> approve -> run -> receipt` semantics.

A future generic `StationSpec` may compile desired room/capability intent into StarNet's official station planning/build APIs. It must reconcile/diff a live station; it must never overwrite mutable station state on rebuild.

## Voice policy

Do not replace Aleph's voice stack by assumption.

Current StarNet offline speech is a useful integrated UX but its bundled local ASR is Whisper Tiny English on CPU and its local TTS is Kokoro on CPU. Aleph's host already provides a Portuguese Nemotron streaming ASR service.

Implement provider seams before choosing a winner:

- StarNet Live Voice/UI remains usable.
- STT and TTS backends can be injected/configured without forking the UI flow.
- First local adapter target: the existing OpenAI-compatible Nemotron ASR endpoint.
- Keep upstream bundled speech as fallback when it is useful.
- Compare WER/accuracy, endpoint latency, first-use latency, CPU/RAM, stability and PT-BR behavior before removing either backend.

## Five implementation blocks

### 1. Rebase the foundation and make downstream patches explicit

- Advance this branch from the historical `0.13.2`-era Nix lane to the vetted current upstream baseline, starting with v0.13.3 security changes.
- Preserve the existing Nix flake/package/module work only where it still matches current upstream.
- Add `upstream`, `linux` and `pauli` remotes in local engineering checkouts.
- Keep a small downstream patch ledger/documentation.
- Fix the headless CLI task contract (`starnet -p` must run a real task/tool surface) with focused tests if current upstream still lacks it.
- Run upstream fast/http/security gates before any Linux/Tauri work.

Exit: current upstream behavior + small named downstream delta, green gates.

### 2. Make Linux/Tauri first-class for this downstream, with an external sidecar

- Audit MValancy's Linux PR/file set against current upstream. Port only still-missing Linux behavior.
- Build the native Tauri/WebKit shell reproducibly with Nix on x86_64-linux; retain aarch64 structure where cheap but do not block this workstation on it.
- Add an explicit desktop attach mode so Tauri can connect to an already-running, authenticated loopback sidecar instead of always spawning/owning one.
- Preserve upstream spawn-owned mode for normal users; attach mode is additive.
- Browser and Tauri must be able to view the same canonical station without creating a second workspace/sidecar.
- Validate Hyprland/Wayland, Secret Service/keyring behavior, external links, clipboard, microphone permissions, clean close/reopen and sidecar independence.
- Port MValancy ONNX/voice native fixes only if the selected StarNet local speech path actually needs them.

Exit: Tauri is the primary local UI; browser remains a secondary client; closing either UI does not kill the systemd-owned station.

### 3. Standardize machine ingress, voice providers and declarative station reconciliation

- Enable/test StarNet's authenticated `/v1` external-harness API without exposing it publicly.
- Keep CLI, `/v1`, Tauri and browser attached to one station and one permission model.
- Add generic injectable STT/TTS provider seams and an adapter for the existing local Nemotron ASR endpoint; retain upstream speech fallback.
- Prototype a minimal generic `StationSpec`/reconciler inspired by CityOS semantics, but compile through current upstream station planning/build APIs. Desired topology is diffed/planned/applied; it is not recreated by Nix.
- No Aleph-specific room names/business topology in this repository; Nix/local config supplies concrete desired state later.

Exit: external clients can invoke real tool-using StarNet runs; voice backends are swappable; declarative topology can be planned safely without reset.

### 4. Add thin generic adapters for the existing business systems

Integrate through native surfaces; do not create competing orchestrators.

- FlowWink: HTTP MCP connector, FlowPilot not the meta-orchestrator.
- win: StarNet plugin/terminal exposing inspection/preparation/recording surfaces while StarNet remains wake authority. Do not start a competing scheduler daemon.
- Business Master: thin plugin/CLI adapter, initially OBSERVE/SHADOW only. Expose typed economic decisions/evidence; no capital control until independently validated.
- OpenMAO: governance plugin/capability gate for policy/approval/audit. Long approvals create durable pending state and block/retry; hooks must not wait indefinitely. OpenMAO may reduce authority, never bypass StarNet consent.
- RAGFlow/SurfSense: retrieval/research adapters using their native HTTP/API surfaces.
- ComfyUI: media capability/plugin over its existing HTTP surface, suitable for a creative/video room.

Prefer StarNet plugins for local CLI/library tools and MCP/HTTP for systems that already expose a good server contract.

Exit: StarNet can discover/call each system in its correct role with innocuous round-trip tests, without running a commercial workflow.

### 5. NixOS deployment, migration and proof

- Evolve the existing Nix package/Home Manager module instead of creating a second packaging stack.
- Pin source/dependency hashes; add update tooling/checks so new upstream candidates can be built and tested before promotion.
- Host config owns `systemd --user`, XDG paths, loopback endpoints, secret environment files/credential handles and desired topology input.
- Remove stale Ninja references from the active business-stack integration.
- Migrate the current live station in place: backup first, never initialize over it, never change its workspace path accidentally.
- Prove Tauri UI, browser UI, CLI, `/v1`, local models and every adapter against the same station.
- Measure Tauri vs browser memory/latency and StarNet-vs-local voice quality rather than assuming either winner.

Exit: one Nix rebuild produces the complete runtime composition without resetting mutable StarNet state; all Phase-2 integrations are healthy. Business workflows remain Phase 3.

## Upstream contribution strategy

The StarNet project accepts scoped external contributions. Keep our downstream broad enough for our workstation, but contribute upstream one generic change at a time:

- headless task/tool contract bug;
- external-sidecar attach mode (open an issue first because it changes desktop lifecycle architecture);
- isolated Linux/Wayland correctness fixes with reproductions;
- generic voice provider seam if upstream agrees with the design.

Do not submit the local business stack, Aleph's NixOS topology or a monolithic Linux/Nix/business PR upstream.

## Definition of Phase 2 complete

A single persistent station can be opened by Tauri and browser; CLI and authenticated `/v1` run real tool-using tasks; local/remote brains can be selected; voice has a tested provider seam; FlowWink, win, OpenMAO, Business Master, RAGFlow, SurfSense and ComfyUI are visible/callable through narrow adapters; Nix can reproduce the software/runtime composition; and no business workflow has been activated.