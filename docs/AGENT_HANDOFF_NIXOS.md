# Host handoff — Aleph NixOS

Target branch: `AlephCasara/starnet:integration/nixos-hermes`

Your role is host validation/integration, not redesign. Read `docs/NIXOS_INTEGRATION.md` first.

## Exact host shape

The host composition has already been inspected. Preserve its existing convention: `home.nix` is only the Home Manager composition root; implementation lives under `modules/home/`.

### 1. Add one flake input

In `/etc/nixos/flake.nix`, alongside the other root inputs:

```nix
starnet = {
  url = "github:AlephCasara/starnet/integration/nixos-hermes";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

Do not add another nixpkgs or Home Manager graph for StarNet.

### 2. Add one local Home Manager module

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
    package = inputs.starnet.packages.${pkgs.stdenv.hostPlatform.system}.starnet;

    # Claude Code already lives in environment.systemPackages.
    claudeCommand = "/run/current-system/sw/bin/claude";
    claudeExternalManagedAuth = true;

    # Hermes already lives in the Home Manager profile via hermes.nix.
    hermes = {
      enable = true;
      provider = "nous";
      port = 8645;
      exposeAsCustomProvider = false;
    };
  };
}
```

### 3. Add exactly one composition-root import

In `/etc/nixos/home.nix` add:

```nix
./modules/home/starnet.nix
```

beside the other `modules/home/*.nix` imports.

No new `extraSpecialArgs` entry is required: the existing Home Manager composition already receives `inputs` and `pkgs`.

## Existing runtimes to reuse

Claude Code is already in the NixOS system profile. The StarNet bridge only satisfies StarNet's `claude auth status` readiness probe. Every real turn execs `/run/current-system/sw/bin/claude`, whose `/etc/claude-code/managed-settings.json`, `apiKeyHelper`, hooks and Z.ai endpoint remain authoritative. Do not move the GLM key into StarNet or Nix source.

Hermes is already installed by `modules/home/hermes.nix`. The StarNet module defaults to `${config.home.profileDirectory}/bin/hermes`, so do not export/rebuild the private `hermesAgent` binding and do not create a second `HERMES_HOME`.

Keep `hermes.exposeAsCustomProvider = false` initially because this host also uses local OpenAI-compatible model serving. In the StarNet UI, configure the Custom OpenAI-Compatible provider explicitly to `http://127.0.0.1:8645/v1` for the Hermes test.

## Package constraints already solved in the fork

The StarNet Nix package has a pinned npm dependency hash and keeps both generations of `onnxruntime-node` CPU-only with their upstream-supported skip switches. Do not re-enable the CUDA/TensorRT download: the CPU runtime is bundled and StarNet auxiliary media must not compete with the primary LLM GPU slot.

The GitHub CI for the fork already proves the Nix package build and boots the packaged sidecar against `/api/health`. Re-run the fork checks if you change packaging; do not rediscover or replace the packaging design merely because this is Linux.

## Host validation sequence

1. Apply only the three host edits above.
2. Inspect the flake diff and lockfile update before rebuild; make sure unrelated inputs did not drift.
3. Evaluate/build the resulting host configuration before switching.
4. After activation, verify:

```bash
systemctl --user status starnet-hermes-proxy.service
curl -fsS http://127.0.0.1:8645/health
curl -fsS -H 'Authorization: Bearer local-only' http://127.0.0.1:8645/v1/models
systemctl --user status starnet.service
curl -fsS http://127.0.0.1:8787/api/health
```

5. In StarNet, test Hermes through Custom OpenAI-Compatible at `http://127.0.0.1:8645/v1` with one plain-text turn and one real StarNet tool call.
6. Test the upstream `claude-cli` provider using the `sonnet` alias first. Confirm that the real backend is the host's intended Z.ai/GLM route before trying explicit Claude release IDs or unattended tasks.
7. Verify the existing managed Claude Code hooks/policies still apply and no secret was duplicated.
8. Do not enable scheduled/unattended StarNet routines until both interactive provider paths are proven on this Linux host.

## Failure policy

Fix the narrowest verified boundary. Do not create a second StarNet state root, second Hermes home, Docker deployment, global npm install, duplicated Claude config, broad compatibility shim, or Agentic Graph Platform dependency merely to make the smoke test pass.

Report back with:

- exact StarNet branch/commit consumed;
- host flake/module diff summary;
- build/check result;
- systemd status for both services;
- Hermes `/health` and `/v1/models` result summary;
- StarNet text/tool-call smoke result through Hermes;
- StarNet `claude-cli` smoke result and observed actual backend/model;
- any remaining failure with exact logs and the smallest suspected boundary.
