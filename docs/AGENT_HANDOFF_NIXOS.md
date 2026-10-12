# Host handoff — Aleph NixOS

Target branch: `AlephCasara/starnet:integration/nixos-hermes`

Your role is host validation/integration, not redesign. Read `docs/NIXOS_INTEGRATION.md` first.

## Required sequence

1. Inspect the current `/etc/nixos` composition only to place the StarNet input/module correctly. Do not repackage Claude Code or Hermes.
2. Do not revive the removed Agentic Graph Platform or copy its paths/policies.
3. Do not install StarNet, Claude Code or Hermes imperatively.
4. Use this repository branch as a flake input and import `homeManagerModules.starnet` into the existing Home Manager composition.
5. Set `services.starnet.package` to this input's package for the host system.
6. Claude Code is already in the NixOS system profile (`environment.systemPackages` via the existing `claudeCode` binding). Configure StarNet to reuse it directly:

```nix
services.starnet.claudeCommand = "/run/current-system/sw/bin/claude";
services.starnet.claudeExternalManagedAuth = true;
```

This bridge only satisfies StarNet's `claude auth status` readiness probe. Every real turn execs the existing Claude Code binary, whose managed settings + `apiKeyHelper` + Z.ai endpoint remain authoritative. Do not move the GLM key into StarNet or into Nix source.

7. Hermes is already installed by `modules/home/hermes.nix`. The StarNet module defaults to `${config.home.profileDirectory}/bin/hermes`, so no Hermes package binding needs to be exported or rebuilt. Configure only:

```nix
services.starnet.hermes = {
  enable = true;
  provider = "nous";
  port = 8645;
  exposeAsCustomProvider = false;
};
```

Keep `exposeAsCustomProvider = false` initially because this host also uses local OpenAI-compatible model serving. We do not want Hermes to steal the generic custom endpoint globally.

8. The StarNet Nix package already has a pinned npm dependency hash and explicitly keeps `onnxruntime-node` CPU-only (`ONNXRUNTIME_NODE_INSTALL=skip`). Do not enable its CUDA/TensorRT download: the CPU runtime is bundled upstream and StarNet auxiliary media must not compete with the main LLM GPU slot.
9. Run the StarNet flake checks/build before touching the host rebuild.
10. Smoke-test manually before enabling unattended use:

```bash
systemctl --user status starnet-hermes-proxy.service
curl -fsS http://127.0.0.1:8645/health
curl -fsS -H 'Authorization: Bearer local-only' http://127.0.0.1:8645/v1/models
systemctl --user status starnet.service
curl -fsS http://127.0.0.1:8787/api/health
```

11. In StarNet, test Hermes through Custom OpenAI-Compatible at `http://127.0.0.1:8645/v1` with one plain-text turn and one real StarNet tool call.
12. Test the `claude-cli` provider using the `sonnet` alias first. Confirm from the Claude/GLM side that the actual backend is the intended Z.ai/GLM route before trying explicit Claude release IDs or unattended tasks.
13. Verify the existing managed Claude Code hooks/policies still apply and no secret was duplicated.
14. Only after these checks pass, perform the host's established rebuild command.

## Failure policy

If something fails, fix the narrowest verified boundary. Do not create a second StarNet state root, second Hermes home, Docker deployment, global npm install, duplicated Claude config, or broad compatibility shim unless evidence proves it is required.

Report back with:

- exact StarNet branch/commit consumed;
- build/check results;
- systemd status for both services;
- Hermes `/health` and `/v1/models` result summary;
- StarNet text/tool-call smoke result through Hermes;
- StarNet `claude-cli` smoke result and observed actual backend/model;
- any remaining failure with exact logs and the smallest suspected boundary.
