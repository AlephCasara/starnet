# StarNet on NixOS — integration lane

This branch is the NixOS integration surface for Aleph's workstation. It intentionally keeps the StarNet product code close to upstream and composes existing runtimes instead of copying large historical forks.

## Baseline

- Upstream base: `androoAGI/starnet` branch `feat/harness-backend`.
- Baseline commit when this lane was created: `54899e5ff3f2b002b457757916b3977818db6fc1`.
- Linux target: native Node sidecar + browser/PWA first. Tauri is not required for the initial deployment.
- State remains in StarNet's upstream XDG locations. Do not invent a second persistent state root.

## What upstream already gives us

Do not re-port these from old forks:

- `claude-cli` provider is already in current upstream. It executes the local Claude Code CLI with Claude's own tools disabled and routes tool requests through StarNet's capability/consent layer.
- Hermes/OpenClaw profile import already exists in `sidecar/harness-import.js`.
- `custom` already speaks OpenAI-compatible HTTP endpoints.
- The terminal CLI (`bin/starnet.js`) and the Node sidecar are Linux-aware and use XDG paths.

The old `acbrazzl/starnet:feat/claude-code-crew` branch remains useful as historical evidence for Linux/Claude-session projection and remote-host ideas, but it is not our merge base.

## Hermes: use the native proxy before writing an adapter

Current Hermes Agent exposes:

```text
hermes proxy start --provider nous --host 127.0.0.1 --port 8645
```

The proxy is OpenAI-compatible and forwards `/v1/models`, `/v1/chat/completions`, `/v1/completions`, and `/v1/embeddings` while attaching the existing Hermes/Nous OAuth credential. StarNet can therefore consume Hermes/Nous models without reading or duplicating Hermes credentials.

Smoke checks:

```bash
curl -fsS http://127.0.0.1:8645/health
curl -fsS -H 'Authorization: Bearer local-only' http://127.0.0.1:8645/v1/models
```

In StarNet, point **Custom OpenAI-Compatible** at:

```text
http://127.0.0.1:8645/v1
```

No real bearer secret is required by the local proxy; it replaces inbound authorization with the Hermes credential before forwarding upstream.

This path gives StarNet direct model inference through the Hermes/Nous account. It does **not** run a second Hermes agent loop, so StarNet remains the owner of tools, consent and orchestration. That is the desired first integration.

On Aleph's host, `modules/home/hermes.nix` already installs the patched Hermes package into the Home Manager profile. The StarNet module therefore defaults to `${config.home.profileDirectory}/bin/hermes`; no Hermes derivation is rebuilt and no private module binding needs to be exported.

## Claude Code + the existing Z.ai/GLM policy

The current StarNet `claude-cli` provider accepts `STARNET_CLAUDE_BIN`. Aleph's host already places Claude Code in the NixOS system profile as `claudeCode`, so StarNet can reuse `/run/current-system/sw/bin/claude` directly instead of threading the private flake binding into Home Manager.

Aleph's host manages Claude Code through `/etc/claude-code/managed-settings.json`, an `apiKeyHelper`, and the Z.ai Anthropic-compatible endpoint. StarNet upstream normally gates `claude-cli` readiness on `claude auth status`, which can legitimately say signed out in this externally managed mode.

Set:

```nix
services.starnet.claudeCommand = "/run/current-system/sw/bin/claude";
services.starnet.claudeExternalManagedAuth = true;
```

The module then places a tiny bridge behind `STARNET_CLAUDE_BIN`. It answers only the readiness probe `claude auth status` with `authMethod = external-managed`; every real Claude invocation is `exec`'d unchanged into the existing Claude Code binary. The bridge never reads, stores or forwards a credential. Do not enable this option for Claude subscription stacking.

First live probe should use the `sonnet` alias, not a hard-coded Anthropic release id. The host's managed Claude configuration is expected to map its default Sonnet family to GLM-5.3. Verify the actual reported model/backend before enabling unattended work.

## Nix package policy

The package uses `buildNpmPackage`, Node 22 and the repository lockfile. The npm dependency hash was resolved by GitHub Actions against this exact lockfile and is pinned in `nix/package.nix`.

StarNet's dependency graph currently contains two generations of `onnxruntime-node`: the newer Transformers dependency and an older copy nested under `kokoro-js`. Both ship the CPU runtime but try to download CUDA/TensorRT binaries during installation on Linux/x64. The Nix derivation sets both documented skip variables:

```text
ONNXRUNTIME_NODE_INSTALL=skip
ONNXRUNTIME_NODE_INSTALL_CUDA=skip
```

This keeps the build network-pure and deliberately leaves StarNet's auxiliary ONNX workloads CPU-only, preserving the primary GPU slot for the local LLM stack.

## Nix outputs

This branch adds:

- `packages.<system>.starnet`
- `packages.<system>.default`
- `overlays.default`
- `homeManagerModules.starnet`

### Consume from the host flake

Example input:

```nix
starnet = {
  url = "github:AlephCasara/starnet/integration/nixos-hermes";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

Import the module in the existing Home Manager module list:

```nix
inputs.starnet.homeManagerModules.starnet
```

Aleph-host configuration:

```nix
services.starnet = {
  enable = true;
  package = inputs.starnet.packages.${pkgs.system}.starnet;

  claudeCommand = "/run/current-system/sw/bin/claude";
  claudeExternalManagedAuth = true;

  hermes = {
    enable = true;
    provider = "nous";
    port = 8645;

    # Keep false initially because this host also uses local OpenAI-compatible
    # serving. Set true only if the generic StarNet custom slot should be
    # permanently bound to Hermes.
    exposeAsCustomProvider = false;
  };
};
```

## Host validation contract

The local coding agent should not redesign this integration. Its job is host-specific verification:

1. `nix flake check` this StarNet branch/package.
2. Build the package and run `starnet-server` manually once on loopback.
3. Confirm `http://127.0.0.1:8787` loads and state lands in the existing upstream XDG location.
4. Confirm the existing Hermes profile binary starts `hermes proxy` and `/health` + `/v1/models` work.
5. Configure StarNet Custom -> `http://127.0.0.1:8645/v1`; run one text turn and one StarNet tool-calling turn on a Hermes/Nous model.
6. Run one `claude-cli` text turn using `sonnet`; confirm the actual backend is the host's intended GLM/Z.ai route and that no Claude API credential was copied into StarNet.
7. Only after both paths pass, enable the user services and perform the normal NixOS rebuild.
8. Do not introduce Docker, imperative npm globals, a second Hermes home, or a separate StarNet state directory merely to make the smoke test pass.

## Later lane: Hermes as live crew/runtime

A deeper adapter is intentionally deferred. Hermes has `--oneshot`, `chat --query`, ACP and MCP server surfaces, but wrapping the full Hermes agent loop inside StarNet would create competing tool/consent/session ownership unless the boundary is designed explicitly.

If the proxy integration proves insufficient, implement the next lane on a new branch with these invariants:

- Hermes credentials remain owned by Hermes.
- Exactly one layer owns tool execution for a turn.
- StarNet capability/consent guarantees are not bypassed.
- No profile or memory files are mutated just to bridge a single turn.
- Streaming, cancellation, usage accounting and quota exhaustion get first-class tests before the provider is exposed in the UI.

That work should reuse upstream Hermes ACP/CLI contracts and current StarNet provider seams rather than resurrecting a stale fork wholesale.
