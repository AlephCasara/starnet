# Aleph NixOS host handoff — minimal runbook

Target: `AlephCasara/starnet:integration/nixos-hermes`

This file is the authoritative installation runbook. Do **not** re-research StarNet, forks, packaging, Hermes integration, or Nix architecture unless a concrete host failure requires it. `docs/NIXOS_INTEGRATION.md` and `docs/DONOR_MAP.md` are reference/failure-analysis material, not required reading for the normal install.

## Authority and token budget

The Ouroboros repository has already been inspected as a **read-only snapshot**, not a deployment source. The live `/etc/nixos` tree is authoritative. Spend only enough time locally to confirm that the relevant composition has not drifted materially from these known facts:

- `/etc/nixos/flake.nix` owns flake inputs and NixOS/Home Manager composition.
- `/etc/nixos/home.nix` is composition-only; implementation belongs in `modules/home/*.nix`.
- Home Manager already receives `inputs` through `home-manager.extraSpecialArgs`; do not add another argument graph.
- Claude Code is already packaged from `numtide/llm-agents.nix`, installed in the system profile, and governed by `/etc/claude-code/managed-settings.json` plus `apiKeyHelper` and existing hooks. Preserve that entire path.
- Hermes is already packaged in `modules/home/hermes.nix`. Its mutable user profile stays under the upstream Hermes home, while `/etc/hermes/config.yaml` is a deliberate managed-scope overlay. Preserve this split.
- Do not create a StarNet-specific state root. Let StarNet keep its upstream/XDG state behavior.
- Application code remains in the StarNet repository; `/etc/nixos` only consumes its flake/module and expresses host policy.
- The decommissioned Agentic Graph Platform is not an integration target.

Before editing, read the live `/etc/nixos/AGENTS.md`. Consult `/etc/nixos/TOPOLOGY.md` only if a new persistent path becomes necessary. Do not scan the whole workstation or Ouroboros again.

If the live host contradicts one of the facts above, trust the live host and adapt the **smallest** part of this runbook necessary. Do not redesign the integration.

## Why this local Nix layer exists

Current StarNet upstream still has no public/supported Linux release path or official NixOS/Home Manager module. The fork therefore carries the minimum Linux/Nix adaptation around upstream application code. The package and module have already passed GitHub CI, including `nix flake check`, package build, Home Manager module evaluation, and packaged-sidecar `/api/health` smoke testing.

Do not replace this with Docker, global npm, an FHS install, or a second application copy merely because upstream's public desktop release train targets Windows/macOS.

## Required host change: exactly three source edits

### 1. Add one flake input

In `/etc/nixos/flake.nix`, alongside the existing root inputs:

```nix
starnet = {
  url = "github:AlephCasara/starnet/integration/nixos-hermes";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

Do not add another nixpkgs or Home Manager input graph.

### 2. Create one Home Manager domain module

Create `/etc/nixos/modules/home/starnet.nix`:

```nix
{
  inputs,
  pkgs,
  ...
}:
{
  imports = [
    inputs.starnet.homeManagerModules.starnet
  ];

  services.starnet = {
    enable = true;

    # Use the fork's CI-tested package rather than rebuilding the package
    # implicitly from the host package set.
    package = inputs.starnet.packages.${pkgs.stdenv.hostPlatform.system}.starnet;

    # Existing host Claude Code remains authoritative for auth/model/hooks.
    claudeCommand = "/run/current-system/sw/bin/claude";
    claudeExternalManagedAuth = true;

    # Reuse the existing Hermes executable/profile. The proxy is only a
    # loopback OpenAI-compatible transport for StarNet.
    hermes = {
      enable = true;
      provider = "nous";
      port = 8645;
      exposeAsCustomProvider = false;
    };
  };
}
```

Do not export/refactor the private `hermesAgent` binding from the existing Hermes module. Do not duplicate Claude Code configuration or credentials.

### 3. Add one composition import

In `/etc/nixos/home.nix`, add beside the existing `modules/home/*.nix` imports:

```nix
./modules/home/starnet.nix
```

No other host source change is expected for the normal installation.

## Narrow validation path

Use the host's normal Nix workflow. Avoid broad updates.

1. Inspect `git -C /etc/nixos status --short` before editing and preserve unrelated work.
2. Apply only the three source edits above.
3. Materialize the new lock entry with a narrow `nix flake lock` from `/etc/nixos`; inspect `flake.lock` and reject unrelated input movement.
4. Format only the touched Nix files, not the whole repository, unless the host formatter requires otherwise.
5. Run `nix flake check -L`.
6. Run `sudo nixos-rebuild test --flake .#nixos-btw` before any switch. Inspect relevant failed units if it fails.
7. Review the final `/etc/nixos` diff. Do not use `REBUILD_DIRTY=1` to bypass the host's clean-tree policy. Commit the reviewed declarative change if required by the existing rebuild workflow.
8. Only after the test generation is healthy, switch using the host's established rebuild mechanism.

Do not run a general `nix flake update`.

## Runtime smoke tests

After activation:

```bash
systemctl --user status starnet-hermes-proxy.service --no-pager
curl -fsS http://127.0.0.1:8645/health
curl -fsS -H 'Authorization: Bearer local-only' http://127.0.0.1:8645/v1/models

systemctl --user status starnet.service --no-pager
curl -fsS http://127.0.0.1:8787/api/health
```

Then perform exactly these functional checks before expanding scope:

1. In StarNet, configure **Custom OpenAI-Compatible** to `http://127.0.0.1:8645/v1` and complete one plain-text Hermes/Nous turn.
2. Through the same provider, execute one real StarNet tool call. Text generation alone is not sufficient proof.
3. Test StarNet's upstream `claude-cli` provider with the `sonnet` alias. Confirm the actual host route remains Z.ai/GLM-5.3 through the existing Claude Code managed configuration.
4. Confirm existing Claude Code managed hooks/policies still apply and that no credential was copied into StarNet, Nix source, or the Nix store.

Do not enable scheduled/unattended StarNet routines until both Hermes and Claude CLI interactive paths are proven.

## Failure policy

When something fails, identify the first failed boundary and fix only that boundary. Do not create a second StarNet state root, second Hermes home, Docker deployment, global npm install, duplicated Claude configuration, new credential store, broad compatibility shim, AGP dependency, or CUDA runtime for StarNet as a workaround.

Only then consult the longer integration/donor documents or upstream implementation relevant to that specific failure.

## Final report

Return only:

- exact StarNet branch + locked commit;
- the four host files changed (`flake.nix`, `flake.lock`, `home.nix`, `modules/home/starnet.nix`) or explain any justified deviation;
- `nix flake check` and `nixos-rebuild test/switch` result;
- status of `starnet` and `starnet-hermes-proxy`;
- Hermes `/health` and `/v1/models` summary;
- Hermes text + tool-call smoke result;
- Claude CLI/GLM-5.3 smoke result;
- any remaining failure, with the smallest identified boundary and exact relevant error.
