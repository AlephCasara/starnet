# Linux donor matrix

`mvalancy/starnet-linux` is a donor/reference repository, not a merge base. This matrix records which Linux findings remain relevant against StarNet upstream `v0.13.3` (`b35cf4ee31c61aa327109ad771723621196d8069`).

The rule is: port the problem statement first; reuse code only when the current upstream seam still matches. Installer-oriented work is not automatically appropriate for Nix.

| Subsystem / donor idea | Problem found by donor | v0.13.3 status | Downstream decision | Retirement / follow-up |
| --- | --- | --- | --- | --- |
| Process-group termination | Shell commands can leave descendants/orphans on Unix when only the direct child is killed. | Upstream now launches/terminates process groups in the current `sidecar/tools/builtin/shell.js` path and reports group-kill failures through its current failure-note seam. | **Do not port** donor commit `61ea448f3fceae0159c4e60310ca5c915471e5d3` literally. Keep upstream implementation. | Re-audit only if upstream removes or materially changes its group ownership/termination semantics. |
| ONNX Runtime ABI isolation | Transformers and Kokoro can load different `onnxruntime-node` versions with the same Linux SONAME, causing the second native addon to bind to the wrong ABI. | **Still present.** The current dependency graph carries two runtime versions while Linux native libraries retain the same `libonnxruntime.so.1` identity. | **Reimplemented** against v0.13.3 as `scripts/prepare-linux-native.mjs`; used by desktop voice staging and the Nix runtime closure. Design attribution: donor commit `e8d7a7abeed90fff6cde06adea80630846fb11b1`. | Delete when upstream converges to one ABI or ships equivalent SONAME isolation. See `docs/DOWNSTREAM_PATCHES.md`. |
| Linux target recognition in voice staging | Desktop staging must recognize Linux x64/arm64 and retain only target-native binaries. | Upstream staging already understands Linux targets and prunes foreign native binaries, but did not isolate the conflicting SONAMEs. | **Keep upstream staging** and add only the ABI isolation call + stale-resource cleanup required by the current graph. | Upstreamable as a small Linux correctness patch separate from Nix packaging. |
| `prepare-node.mjs` bundled Node runtime | Traditional Tauri installers need a target Node executable/checksum beside the app. | Relevant to AppImage/deb-style self-contained installers; not required for the Nix runtime package, where Node is an immutable dependency in the store. | **Do not copy into Nix packaging.** Revisit only for a conventional Linux installer output. | The Nix desktop package should depend on `nodejs_22` declaratively rather than download/stage a runtime. |
| AppImage/deb Tauri targets | Linux needs a Tauri bundle target and native desktop closure. | Upstream v0.13.3 still advertises Windows/macOS bundle targets only. | **Problem remains, implementation differs.** Build the Linux desktop through Nix/Tauri/WebKitGTK first; do not make AppImage/deb the Nix source of truth. | A conventional upstream Linux bundle can be proposed later as a separate concern. |
| WebKitGTK / GTK native dependencies | Tauri on Linux needs WebKitGTK, GTK and related build/runtime libraries. | Still inherently required for Linux Tauri; upstream does not package them for Nix. | **Carry in Nix desktop derivation**, with explicit closure and CI. Avoid apt/dnf bootstrap scripts inside the package build. | Remove Nix-specific dependency glue only if upstream provides an equivalent Nix package or a reusable packaging interface. |
| Linux CI | Linux-specific breakage was otherwise invisible. | Upstream desktop/release CI is still centered on its declared Windows/macOS product targets. | **Keep downstream Linux/Nix CI.** Add a Tauri Linux build gate once the desktop derivation lands. | Upstreamable tests may move upstream even if official Linux packaging does not. |
| X11 desktop behavior | Donor established a useful Linux baseline. | Useful evidence, but not sufficient for the target environment. | Treat as **reference evidence**, not completion. | Explicitly validate Wayland/WebKitGTK/Hyprland behavior in CI where possible and on the host only in the later consumption phase. |
| Wayland / Hyprland | Native WebKit/GTK behavior and desktop integration differ from X11. | Donor work does not prove the target path fully. | **Needs current implementation and validation**; no donor patch is accepted merely because X11 worked. | Keep platform conditionals minimal and prefer Tauri/GTK defaults over compositor-specific code. |
| Sidecar spawn/cleanup in desktop | Traditional desktop owns its child sidecar. Nix/systemd may own the canonical station instead. | Upstream desktop still constructs a private port/token and owns spawn, crash guardian, restart and shutdown. | **Do not reuse donor lifecycle wholesale.** Implement a generic externally-managed attach mode against current Tauri lifecycle seams. | Attach mode must never reap, restart, reset or kill a sidecar it does not own. |
| Browser UI on Linux | Browser should reach the same station rather than a second workspace/process. | Upstream v0.13.3 already has authenticated browser/CLI/MCP/ACP token discovery and same-user peer-owner hardening. | **Reuse upstream security model.** No global `STARNET_TRUST_LOCAL_PEERS=1`. | External desktop attach should reuse the same token-discovery contract rather than invent another secret channel. |

## Installer scripts vs Nix

The donor's imperative preparation scripts are evidence about native runtime requirements, not a template for a Nix derivation. The Nix path keeps these rules:

- dependencies are fetched/pinned by Nix/npm fixed-output inputs, not during the build;
- native patching happens deterministically inside the sandbox;
- mutable workspaces and credentials stay outside `/nix/store`;
- `systemd --user` may own the canonical sidecar, while the desktop is allowed to attach without spawning another one;
- no global package-manager mutations, `curl | sh`, or host bootstrap scripts belong in the derivation.

## Current donor-derived code

Only one donor design has been ported so far: Linux ONNX ABI isolation. It is intentionally a fresh implementation against the v0.13.3 staging/Nix seams rather than a wholesale donor merge. All other rows above are either already solved upstream, architectural evidence, or pending current-code implementation.
