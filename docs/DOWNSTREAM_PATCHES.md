# Downstream patch ledger

This branch is a small Linux/NixOS downstream of `androoAGI/starnet`. Upstream remains the product authority. Every downstream delta must be generic, tested where practical, and removable when upstream provides equivalent behavior.

## Baseline

- Upstream release: `v0.13.3`
- Upstream commit: `b35cf4ee31c61aa327109ad771723621196d8069`
- Working branch: `integration/nixos-starnet-product`
- Donor/reference repositories are never merge bases: `mvalancy/starnet-linux` and `executiveusa/pauli-starnet`.

## Retirement rules

A patch stays only while all of these are true:

1. current upstream still lacks the behavior;
2. the behavior is generic rather than host/business-specific;
3. the patch does not weaken StarNet security or consent semantics;
4. its tests or verification still justify carrying it.

When upstream gains equivalent behavior, first run the downstream gates without the patch. If they pass, delete the patch rather than layering compatibility code on top.

## Active patches

### `nix-runtime-foundation`

**Reason**

Provide a reproducible Linux runtime package plus an optional Home Manager user service without making Nix authoritative over mutable StarNet station state.

**Files**

- `flake.nix`
- `flake.lock`
- `nix/package.nix`
- `nix/home-manager-module.nix`
- `.github/workflows/nix-package.yml`

**Behavior**

- packages the canonical StarNet CLI and sidecar from the repository source;
- pins npm dependencies and nixpkgs;
- prevents optional ONNX CUDA/TensorRT downloads during the Nix build;
- exposes an optional `systemd --user` sidecar service;
- permits a host-managed Claude Code readiness bridge without copying credentials;
- permits an optional Hermes OpenAI-compatible proxy without making Hermes an agent-loop/orchestration authority.

**State boundary**

The package/module do not create, reset, own, or migrate a workspace. Credentials and mutable station state are outside the Nix store.

**Tests / gates**

- `nix flake check -L`
- package build
- Home Manager module evaluation
- sidecar `/api/health` smoke test

**Source / inspiration**

Carried forward from this repository's earlier `integration/nixos-hermes` / `integration/nixos-starnet-foundation` work, re-based onto upstream `v0.13.3` rather than merged wholesale.

**Remove when**

Upstream ships an equivalent maintained Nix package/module (or an upstream packaging interface makes these files redundant) and the same runtime/state invariants are preserved.

---

### `headless-task-capabilities`

**Reason**

`starnet -p` / `starnet run` already place the headless coding-office capability objects, but upstream `v0.13.3` did not mark the `/api/run` payload as task work. StarNet's runtime gates tool availability on `isTask`, so the CLI could request placed capabilities without receiving the actual task tool surface.

**Files**

- `bin/lib/cli-core.js`
- `test/cli.test.js`

**Behavior**

`buildRunBody()` sets `isTask: true` for the real headless run command. Existing placed capabilities, consent, provider selection, and station attachment behavior are unchanged.

**Tests / gates**

`test/cli.test.js` locks the task bit alongside the existing assertions for the user message, placed capability set, and project root.

**Upstreamability**

High. This is a one-line product bug fix plus a one-line regression assertion and is independent of Linux/NixOS.

**Remove when**

Upstream headless CLI emits the same task semantics (whether via `isTask: true` or a renamed equivalent) and the regression test passes without this patch.

---

### `linux-onnx-abi-isolation`

**Reason**

The current offline voice dependency graph contains two `onnxruntime-node` ABIs: the Transformers path and Kokoro's nested runtime. On Linux both native libraries advertise `libonnxruntime.so.1`, so one process can bind the second native addon to the first runtime loaded and fail on incompatible symbols.

**Files**

- `scripts/prepare-linux-native.mjs`
- `scripts/stage-voice-deps.mjs`
- `nix/package.nix`
- `test/desktop-voice-bundle.test.js`
- `flake.nix`

**Behavior**

- each Linux ONNX runtime copy gets a version-qualified SONAME;
- the corresponding `onnxruntime_binding.node` DT_NEEDED entry is rewritten to that SONAME;
- desktop voice staging and the Nix runtime closure both perform the isolation;
- non-Linux staging is unchanged;
- repeated preparation is idempotent;
- warm Tauri resources cannot silently restore an unnamespaced runtime.

**Source / inspiration**

Reimplemented against upstream `v0.13.3` from the design in the MIT-licensed `mvalancy/starnet-linux` commit `e8d7a7abeed90fff6cde06adea80630846fb11b1`. The donor repository is a reference only; it was not merged and its older v0.12.x packaging stack was not adopted wholesale.

**Tests / gates**

- `test/desktop-voice-bundle.test.js` uses two synthetic runtime versions and an injected `patchelf` seam to verify unique SONAMEs, binding rewrite, idempotence and non-Linux no-op behavior;
- the test is also a Nix flake check;
- the normal Nix package build runs the real `patchelf` against the resolved npm closure.

**Upstreamability**

Medium-high as a Linux correctness fix. The implementation should be proposed separately from downstream Nix packaging so upstream can accept the native-loader fix without accepting a new packaging target.

**Remove when**

Upstream either (a) converges the speech dependency graph onto one ABI, or (b) ships an equivalent Linux loader/SONAME isolation strategy and the bundle + Nix regression gates pass with this patch deleted.

---

### `external-sidecar-attach`

**Reason**

A Nix/systemd-managed StarNet needs one canonical station process while still allowing the native Tauri UI to use that same station. Upstream `v0.13.3` always treats the desktop as the sidecar owner, so opening Tauri would otherwise spawn/reap/restart a second process lifecycle.

**Files**

- `src-tauri/src/external_sidecar.rs`
- `src-tauri/src/main.rs`

**Behavior**

- default upstream behavior remains `spawn` / desktop-owned;
- explicit `STARNET_DESKTOP_SIDECAR_MODE=attach` (aliases `external`/`existing`) attaches to the loopback port in `STARNET_PORT` or legacy `SKYNET_PORT`;
- attach mode discovers the station's master API token through the same `GET /` bootstrap contract already used by CLI/MCP/ACP;
- upstream v0.13.3 same-OS-user peer ownership remains the authorization boundary for token injection;
- external mode does not migrate workspace state, reap processes, spawn a child, start a crash guardian, restart/reset the station, send halt/quit during desktop shutdown, or kill the external process;
- native credential mutations fail before touching keychain/workspace because `/api/key` and `/api/channels/token` are intentionally protected by the desktop child's private IPC token, which an attached client must not inherit;
- desktop-owned mode retains its existing credential and lifecycle behavior.

**Security boundary**

The patch does not expose or persist either the master API token or the child-only IPC token. It does not enable `STARNET_TRUST_LOCAL_PEERS`. An external station that withholds its bootstrap token because peer ownership cannot be proved remains fail-closed.

**Tests / gates**

`src-tauri/src/external_sidecar.rs` contains unit coverage for explicit mode parsing, valid/invalid ports, ownership, bootstrap token JSON parsing, and token-withheld failure. The Linux/Tauri build gate is part of the `linux-desktop-package` work and is required before this patch is considered release-ready.

**Upstreamability**

High as a generic desktop lifecycle feature. It is intentionally expressed as `Desktop` vs `External` ownership rather than as a NixOS- or user-specific conditional.

**Remove when**

Upstream desktop provides an equivalent authenticated existing-sidecar/external-runtime mode with the same non-ownership guarantees and tests pass after deleting this patch.

## Security decisions that are not downstream patches

### Remote browser/debug

Upstream `v0.13.3` added fail-closed same-OS-user peer ownership checks before serving the per-launch station token. On Linux the check resolves the client socket owner through `/proc/net/tcp` / `/proc/net/tcp6` and compares its UID with the sidecar UID.

The downstream therefore does **not** enable `STARNET_TRUST_LOCAL_PEERS=1` by default and does not weaken Host/Origin/token checks. SSH/Tailscale access should use loopback forwarding and retain the normal token + peer-owner path. Any environment where peer ownership cannot be proved remains fail-closed unless the operator explicitly chooses upstream's escape hatch outside this repository.

## Planned patches

The following names are reservations, not claims that the features are implemented yet. Add a full ledger entry only when code lands:

- `linux-desktop-package`
- `external-speech-provider`
- `station-spec-reconciliation` (only if current station APIs support a non-destructive implementation)
- external-system adapters only where StarNet's existing MCP/plugin/API seams are insufficient
