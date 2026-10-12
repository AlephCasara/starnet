# Host handoff — Aleph NixOS

Target branch: `AlephCasara/starnet:integration/nixos-hermes`

Your role is host validation/integration, not redesign. Read `docs/NIXOS_INTEGRATION.md` first.

## Required sequence

1. Inspect the current `/etc/nixos` composition and reuse the existing bindings for:
   - `claudeCode` from `llm-agents.nix`;
   - the existing Hermes Agent package/input;
   - Home Manager and the existing flake structure.
2. Do not revive the removed Agentic Graph Platform or copy its paths/policies.
3. Do not install StarNet, Claude Code or Hermes imperatively.
4. Use this repository branch as a flake input and import `homeManagerModules.starnet` into the existing Home Manager composition.
5. Set `services.starnet.package` to this input's package for the host system.
6. Set `services.starnet.claudePackage` to the already-declared Claude Code package.
7. Because this host authenticates Claude Code through managed settings + `apiKeyHelper` + the Z.ai Anthropic-compatible endpoint, set:

```nix
services.starnet.claudeExternalManagedAuth = true;
```

This bridge only satisfies StarNet's `claude auth status` readiness probe. Do not move the GLM key into StarNet or into Nix source.

8. Configure the existing Hermes package under:

```nix
services.starnet.hermes = {
  enable = true;
  package = <existing Hermes package>;
  provider = "nous";
  port = 8645;
  exposeAsCustomProvider = false;
};
```

Keep `exposeAsCustomProvider = false` initially because this host also uses local OpenAI-compatible model serving. We do not want Hermes to steal the generic custom endpoint globally.

9. Resolve the single `lib.fakeHash` in `nix/package.nix` by running the Nix build once and replacing it with Nix's exact `got:` sha256. Change nothing else merely to satisfy the hash.
10. Run the StarNet flake checks/build before touching the host rebuild.
11. Smoke-test manually before enabling unattended use:

```bash
systemctl --user status starnet-hermes-proxy.service
curl -fsS http://127.0.0.1:8645/health
curl -fsS -H 'Authorization: Bearer local-only' http://127.0.0.1:8645/v1/models
systemctl --user status starnet.service
curl -fsS http://127.0.0.1:8787/api/health
```

12. In StarNet, test Hermes through Custom OpenAI-Compatible at `http://127.0.0.1:8645/v1` with one plain-text turn and one real StarNet tool call.
13. Test the `claude-cli` provider using the `sonnet` alias first. Confirm from the Claude/GLM side that the actual backend is the intended Z.ai/GLM route before trying explicit Claude release IDs or unattended tasks.
14. Verify the existing managed Claude Code hooks/policies still apply and no secret was duplicated.
15. Only after these checks pass, perform the normal NixOS rebuild using the host's established rebuild command.

## Failure policy

If something fails, fix the narrowest verified boundary. Do not create a second StarNet state root, second Hermes home, Docker deployment, global npm install, duplicated Claude config, or broad compatibility shim unless evidence proves it is required.

Report back with:

- exact StarNet branch/commit consumed;
- final npm dependency hash;
- build/check results;
- systemd status for both services;
- Hermes `/health` and `/v1/models` result summary;
- StarNet text/tool-call smoke result through Hermes;
- StarNet `claude-cli` smoke result and observed actual backend/model;
- any remaining failure with exact logs and the smallest suspected boundary.
