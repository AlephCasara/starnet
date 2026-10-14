#!/usr/bin/env node
// One-shot guarded source transformation used to keep the GitHub connector edit surgical on the
// large Tauri composition root. Every replacement must match exactly once or the job fails without
// committing. This file and its workflow are removed after the generated diff is reviewed.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src-tauri/src/main.rs';
let source = readFileSync(file, 'utf8');

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`patch ${label}: source anchor not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`patch ${label}: source anchor is not unique`);
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

replaceOnce(
`// Wraps the existing browser app: spawns the zero-dependency Node sidecar on a
// private loopback port, waits for it to listen, then opens that URL in a native
// WebView2 window. The sidecar's lifetime is bound to this process.`,
`// Wraps the existing browser app. By default the desktop owns one Node sidecar on a
// private loopback port. An explicit attach mode can instead use one already-running
// station owned by an external supervisor; in that mode this process never controls
// the station lifecycle.`,
'header ownership contract');

replaceOnce(
`mod erase_all;
mod fresh_start;`,
`mod erase_all;
mod external_sidecar;
mod fresh_start;`,
'module declaration');

replaceOnce(
`    startup_log: Option<PathBuf>,
    sidecar: Mutex<Option<Child>>,`,
`    startup_log: Option<PathBuf>,
    sidecar_ownership: external_sidecar::SidecarOwnership,
    sidecar: Mutex<Option<Child>>,`,
'AppState ownership');

replaceOnce(
`fn begin_recovery(state: &AppState) -> Result<RecoveryOperation<'_>, String> {
    state`,
`fn begin_recovery(state: &AppState) -> Result<RecoveryOperation<'_>, String> {
    if state.sidecar_ownership.is_external() {
        return Err("this StarNet station is externally managed; use its process supervisor for restart/reset operations".to_string());
    }
    state`,
'recovery ownership guard');

replaceOnce(
`fn spawn_sidecar(state: &AppState) -> bool {
    let entry = state.root.join("sidecar").join("index.js");`,
`fn spawn_sidecar(state: &AppState) -> bool {
    if state.sidecar_ownership.is_external() {
        log_startup(&state.startup_log, "spawn_sidecar: refused for externally managed station");
        return false;
    }
    let entry = state.root.join("sidecar").join("index.js");`,
'spawn ownership guard');

replaceOnce(
`fn stop_sidecar_gracefully(state: &AppState) {
    post_sidecar_quit(state, Duration::from_secs(2));`,
`fn stop_sidecar_gracefully(state: &AppState) {
    if state.sidecar_ownership.is_external() {
        return;
    }
    post_sidecar_quit(state, Duration::from_secs(2));`,
'graceful-stop ownership guard');

replaceOnce(
`fn drain_and_kill_sidecar(state: &AppState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    post_sidecar_halt(state, Duration::from_secs(3));
    stop_sidecar_gracefully(state);
}`,
`fn drain_and_kill_sidecar(state: &AppState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    if state.sidecar_ownership.is_external() {
        return;
    }
    post_sidecar_halt(state, Duration::from_secs(3));
    stop_sidecar_gracefully(state);
}`,
'drain ownership guard');

replaceOnce(
`    // Pick the sidecar port BEFORE the app is built so the webview CSP can name exactly that
    // port (tauri.conf.json can only say 127.0.0.1:*). A second instance also reaches this line
    // but exits through the single-instance plugin before any sidecar is spawned.
    let sidecar_port = free_port();
    pin_config_csp(&mut context.config_mut().app.security.csp, sidecar_port);`,
`    // Resolve ownership BEFORE the app is built so the webview CSP is pinned to the actual
    // station port. Spawn remains the default; attach is explicit and requires STARNET_PORT.
    let sidecar_mode = external_sidecar::DesktopSidecarMode::from_process_env()
        .unwrap_or_else(|error| {
            eprintln!("StarNet desktop sidecar configuration error: {error}");
            std::process::exit(2);
        });
    let sidecar_port = sidecar_mode.fixed_port().unwrap_or_else(free_port);
    pin_config_csp(&mut context.config_mut().app.security.csp, sidecar_port);`,
'main sidecar mode');

replaceOnce(
`            let root = project_root(app.handle());
            let port = sidecar_port; // the port the CSP was pinned to in main()
            let ipc_token = uuid::Uuid::new_v4().to_string();
            // per-launch API token: shared with the sidecar via env (it reads SKYNET_API_TOKEN) AND injected
            // into the bundled webview below, so the desktop UI never has to fetch the token over an open route.
            let api_token = uuid::Uuid::new_v4().to_string();
            let startup_log = startup_log_path(app.handle());`,
`            let root = project_root(app.handle());
            let port = sidecar_port; // the port the CSP was pinned to in main()
            let sidecar_ownership = sidecar_mode.ownership();
            let ipc_token = if sidecar_ownership.is_desktop() {
                uuid::Uuid::new_v4().to_string()
            } else {
                String::new()
            };
            // A desktop-owned launch creates the token it shares with its child. Attach mode instead
            // discovers the already-running station token through StarNet's same-user bootstrap page,
            // exactly like the CLI/MCP/ACP clients; v0.13.3 peer-owner checks remain authoritative.
            let api_token = if sidecar_ownership.is_external() {
                external_sidecar::discover_token(port, Duration::from_secs(8))
                    .map_err(std::io::Error::other)?
            } else {
                uuid::Uuid::new_v4().to_string()
            };
            let startup_log = startup_log_path(app.handle());`,
'setup token ownership');

replaceOnce(
`            let migrated_workspaces = migrate_workspace_data(
                &workspaces,
                &legacy_workspace_paths(&root, &workspaces),
                &startup_log,
            );`,
`            let migrated_workspaces = if sidecar_ownership.is_desktop() {
                migrate_workspace_data(
                    &workspaces,
                    &legacy_workspace_paths(&root, &workspaces),
                    &startup_log,
                )
            } else {
                None
            };`,
'workspace migration ownership');

replaceOnce(
`            // One-time: lift any plaintext channel bot tokens into the keychain and strip them from the file,
            // BEFORE spawning the sidecar so the injected SKYNET_<ID>_TOKEN env reflects the migrated tokens.
            migrate_channel_tokens_from_plaintext(&workspaces);
            // Same one-time sweep for the cloud device token — this is what upgrades an already
            // linked station from a plaintext token to a keychain one, with no user action.
            migrate_credits_token_from_plaintext(&workspaces);`,
`            // Credential migrations mutate the desktop-owned workspace and therefore never run in attach mode.
            // The external station remains the authority for its own mutable state and credential lifecycle.
            if sidecar_ownership.is_desktop() {
                migrate_channel_tokens_from_plaintext(&workspaces);
                migrate_credits_token_from_plaintext(&workspaces);
            }`,
'credential migration ownership');

replaceOnce(
`                startup_log,
                sidecar: Mutex::new(None),`,
`                startup_log,
                sidecar_ownership,
                sidecar: Mutex::new(None),`,
'AppState initialization');

replaceOnce(
`            // Before spawning OUR sidecar: terminate any orphan sidecars left behind by a
            // hard-killed previous shell (Drop/ExitRequested never ran there). Multiple live
            // sidecars on one WORKSPACES dir violate the one-sidecar invariant and burn each
            // other's rotating Codex OAuth refresh tokens. Scoped strictly to processes whose
            // image path IS our bundled node runtime; fail-open, never blocks startup.
            reap_orphan_sidecars(&node_binary(&state.root), &state.startup_log);
            // Bring the sidecar up before starting background supervision. Cancel drops
            // the owned state and child, before a guardian or hidden window can be created.
            // A setup Err becomes a panic in Tauri, and release builds use panic = "abort" — a user
            // pressing Cancel used to "crash" with 0xC0000409. Stop the child ourselves and exit cleanly.
            if !spawn_sidecar_with_retry(app.handle(), &state) {
                state.shutting_down.store(true, Ordering::SeqCst);
                state.kill_sidecar();
                log_startup(&state.startup_log, "startup: cancelled by user; exiting cleanly");
                drop(state);
                std::process::exit(0);
            }
            app.manage(state);
            app.manage(PendingUpdate(Mutex::new(None)));
            app.manage(hud_mode::HudState::default());

            // Respawn the sidecar if it crashes while the window is open (see spawn_guardian).
            spawn_guardian(app.handle().clone());`,
`            let owns_sidecar = state.sidecar_ownership.is_desktop();
            if owns_sidecar {
                // Before spawning OUR sidecar: terminate any orphan sidecars left behind by a
                // hard-killed previous shell. Never reap in attach mode: that station belongs to its supervisor.
                reap_orphan_sidecars(&node_binary(&state.root), &state.startup_log);
                // Bring the owned sidecar up before starting background supervision.
                if !spawn_sidecar_with_retry(app.handle(), &state) {
                    state.shutting_down.store(true, Ordering::SeqCst);
                    state.kill_sidecar();
                    log_startup(&state.startup_log, "startup: cancelled by user; exiting cleanly");
                    drop(state);
                    std::process::exit(0);
                }
            } else {
                log_startup(
                    &state.startup_log,
                    format!("startup: attached to externally managed StarNet station on 127.0.0.1:{}", state.port),
                );
            }
            app.manage(state);
            app.manage(PendingUpdate(Mutex::new(None)));
            app.manage(hud_mode::HudState::default());

            // Only a child owned by this shell may be respawned by its crash guardian.
            if owns_sidecar {
                spawn_guardian(app.handle().clone());
            }`,
'setup spawn/attach lifecycle');

writeFileSync(file, source);
console.log('external-sidecar main.rs transform applied');
