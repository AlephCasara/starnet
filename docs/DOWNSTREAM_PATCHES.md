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

## Security decisions that are not downstream patches

### Remote browser/debug

Upstream `v0.13.3` added fail-closed same-OS-user peer ownership checks before serving the per-launch station token. On Linux the check resolves the client socket owner through `/proc/net/tcp` / `/proc/net/tcp6` and compares its UID with the sidecar UID.

The downstream therefore does **not** enable `STARNET_TRUST_LOCAL_PEERS=1` by default and does not weaken Host/Origin/token checks. SSH/Tailscale access should use loopback forwarding and retain the normal token + peer-owner path. Any environment where peer ownership cannot be proved remains fail-closed unless the operator explicitly chooses upstream's escape hatch outside this repository.

## Planned patches

The following names are reservations, not claims that the features are implemented yet. Add a full ledger entry only when code lands:

- `linux-desktop-package`
- `external-sidecar-attach`
- `external-speech-provider`
- `station-spec-reconciliation` (only if current station APIs support a non-destructive implementation)
- external-system adapters only where StarNet's existing MCP/plugin/API seams are insufficient
