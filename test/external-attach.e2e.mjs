#!/usr/bin/env node
/* test/external-attach.e2e.mjs — External attach, end to end, against the PACKAGED runtime.

   Contract under test (see src-tauri/src/external_sidecar.rs and the systemd --user module):
   an external client boots nothing, spawns nothing, and consumes an existing station over
   loopback: health, the same-user bootstrap token (GET /), an authenticated API call, and
   a token-less call that must stay forbidden. After the client goes away the station must
   still be healthy — external clients never own the lifecycle.

   Usage: node external-attach.e2e.mjs <starnet-server-binary>   (CI/check use only) */
'use strict';
import { spawn } from 'node:child_process';

const serverBin = process.argv[2];
if (!serverBin) { console.error('FAIL: usage: external-attach.e2e.mjs <starnet-server-bin>'); process.exit(2); }

const PORT = 48787;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok - ' + msg); else { failures++; console.error('FAIL - ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers, redirect: 'manual' });
  const body = await res.text();
  return { status: res.status, body };
}

// Minimal bootstrap-token parser, mirroring external_sidecar.rs (JSON string literal).
function tokenFromBootstrap(html) {
  const marker = 'window.__STARNET_API_TOKEN__=';
  const at = html.indexOf(marker);
  if (at < 0) throw new Error('bootstrap page has no API token marker');
  return JSON.parse(html.slice(at + marker.length).split(';')[0]);
}

const home = process.env.STARNET_E2E_HOME;
const child = spawn(serverBin, [], {
  env: {
    ...process.env,
    STARNET_PORT: String(PORT),
    SKYNET_PORT: String(PORT),
    STARNET_WORKSPACES: process.env.STARNET_E2E_WORKSPACES,
    HOME: home,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderrTail = '';
child.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-4000); });
child.stdout.on('data', () => {});
const childExit = new Promise(resolve => child.on('exit', code => resolve(code)));

try {
  // 1. the station becomes healthy on its own (nobody spawns anything for the client)
  let healthy = false;
  for (let i = 0; i < 240; i++) {
    try { const r = await get('/api/health'); if (r.status === 200) { healthy = true; break; } } catch (_) {}
    if (await childExit.then(c => c !== null, () => false)) break;
    await sleep(500);
  }
  ok(healthy, 'station reaches /api/health 200 without any client-side lifecycle');

  // 2. unauthenticated API access stays forbidden
  if (healthy) {
    const anon = await get('/api/connectors');
    ok(anon.status === 403 || anon.status === 401, 'token-less API call is refused (' + anon.status + ')');
  }

  // 3. token discovery through the same-user bootstrap contract
  let token = null;
  if (healthy) {
    const page = await get('/');
    ok(page.status === 200, 'bootstrap page GET / answers 200');
    try { token = tokenFromBootstrap(page.body); } catch (e) { ok(false, 'bootstrap token parses: ' + e.message); }
    ok(!!token && token.length > 0, 'bootstrap token discovered via window.__STARNET_API_TOKEN__');
  }

  // 4. an authenticated external client call succeeds
  if (token) {
    const authed = await get('/api/connectors', { 'x-starnet-token': token });
    ok(authed.status === 200, 'authenticated external call succeeds (' + authed.status + ')');
  }

  // 5. the client "disconnects" (no keep-alive, sockets closed) — the station must survive
  if (healthy) {
    await sleep(1500);
    const after = await get('/api/health');
    ok(after.status === 200, 'station still healthy after the external client went away');
    ok(child.exitCode === null, 'station process was not reaped or exited');
  }
} finally {
  child.kill('SIGTERM');
  await Promise.race([childExit, sleep(5000)]);
}
process.exit(failures ? 1 : 0);
