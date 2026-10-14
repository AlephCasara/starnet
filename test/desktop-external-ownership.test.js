/* node test/desktop-external-ownership.test.js — the External sidecar OWNERSHIP contract.

   The desktop shell has two ownership modes (src-tauri/src/external_sidecar.rs): Desktop
   (upstream default: the shell owns one child sidecar) and External (a systemd/supervisor-
   owned station the shell may only ATTACH to). The runtime behavior lives inside Tauri
   command handlers that need a live webview to execute, so this file is a SOURCE CONTRACT:
   it fails when a lifecycle or credential seam in src-tauri/src/main.rs loses its
   external-ownership guard. If a future change makes External re-own the station lifecycle
   (spawn, guardian restart, quit/halt, recovery reset) or mutate credentials, this test is
   the tripwire. The mode parsing, token bootstrap and fail-closed behavior are additionally
   covered by the Rust unit tests in external_sidecar.rs. Part of test:fast. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const mainRs = fs.readFileSync(path.join(__dirname, '../src-tauri/src/main.rs'), 'utf8');
const externalRs = fs.readFileSync(path.join(__dirname, '../src-tauri/src/external_sidecar.rs'), 'utf8');

// Extract a top-level `fn name(...)` body: from its signature line to the next line that
// is exactly `}` (rustfmt keeps top-level closing braces at column 0).
function fnBody(name) {
  const sig = new RegExp('^\\s*(?:pub(?:\\(crate\\))?\\s+)?(?:async\\s+)?fn ' + name + '\\b');
  const lines = mainRs.split('\n');
  const start = lines.findIndex(l => sig.test(l));
  if (start < 0) throw new Error('function not found in main.rs: ' + name);
  const end = lines.findIndex((l, i) => i > start && l === '}');
  return lines.slice(start, end + 1).join('\n');
}

// ---- External never owns the station lifecycle -----------------------------------------------
{
  const spawn = fnBody('spawn_sidecar');
  A.ok(/is_external\(\)/.test(spawn), 'spawn_sidecar refuses to spawn for externally managed stations');
  A.ok(spawn.indexOf('is_external()') < spawn.indexOf('sidecar_startup::spawn'),
    'the external check precedes any child spawn');

  const stop = fnBody('stop_sidecar_gracefully');
  A.ok(/is_external\(\)/.test(stop), 'stop_sidecar_gracefully checks external ownership');
  A.ok(stop.indexOf('is_external()') < stop.indexOf('post_sidecar_quit'), 'external check precedes the /quit post');

  const drain = fnBody('drain_and_kill_sidecar');
  A.ok(/is_external\(\)/.test(drain), 'drain_and_kill_sidecar checks external ownership');
  A.ok(drain.indexOf('is_external()') < drain.indexOf('post_sidecar_halt'), 'external check precedes the halt post');
  A.ok(drain.indexOf('is_external()') < drain.indexOf('stop_sidecar_gracefully'), 'external check precedes graceful stop');

  const recovery = fnBody('begin_recovery');
  A.ok(/is_external\(\)/.test(recovery), 'begin_recovery checks external ownership');
  A.ok(/externally managed/.test(recovery), 'begin_recovery explains that the supervisor owns restart/reset');

  const adopt = fnBody('harness_adopt_credits_token');
  A.ok(/is_external\(\)/.test(adopt), 'credits-token adoption is refused for externally managed stations');
}

// ---- External never mutates desktop-owned credentials ----------------------------------------
{
  const guard = fnBody('require_desktop_owned_credentials');
  A.ok(/externally managed/.test(guard), 'the credential guard names the external supervisor as the authority');

  // Every keychain-mutating Tauri command must call the guard BEFORE any keychain write.
  const guardedCommands = [
    'harness_store_key',
    'harness_store_provider_key',
    'harness_store_provider_key_pool',
    'harness_clear_credits_token',
    'harness_store_channel_token',
  ];
  for (const name of guardedCommands) {
    const body = fnBody(name);
    const guardAt = body.indexOf('require_desktop_owned_credentials');
    A.ok(guardAt >= 0, name + ' routes through the credential-ownership guard');
    if (guardAt >= 0) {
      const firstMutation = ['keychain_entry', 'set_password', 'delete_credential', 'insert']
        .map(h => body.indexOf(h)).filter(i => i >= 0).sort((a, b) => a - b)[0];
      if (firstMutation !== undefined) {
        A.ok(guardAt < firstMutation, name + ' fails closed BEFORE the first keychain mutation');
      }
    }
  }
}

// ---- The attach mode itself stays minimal and fail-closed ------------------------------------
{
  A.ok(!/STARNET_TRUST_LOCAL_PEERS/.test(mainRs + externalRs),
    'the desktop shell never introduces the peer-ownership trust bypass');

  // The mode table: empty env = upstream desktop-owned spawn; attach needs an explicit port.
  A.ok(/"" \| "spawn" \| "managed" \| "desktop" => Ok\(DesktopSidecarMode::Spawn\)/.test(externalRs),
    'attach mode stays opt-in; the default remains upstream desktop-owned spawn');
  A.ok(/"attach" \| "external" \| "existing"/.test(externalRs),
    'attach/external/existing are the only external spellings');

  // Token discovery uses the existing same-user bootstrap contract (GET /), never a side file.
  A.ok(/GET \/ HTTP\/1\.1/.test(externalRs), 'token discovery speaks the GET / bootstrap contract');
  A.ok(/__STARNET_TOKEN_WITHHELD__/.test(externalRs), 'a withheld token keeps attach fail-closed');
}

A.report ? A.report() : process.exit(A.failed ? 1 : 0);
