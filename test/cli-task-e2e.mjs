#!/usr/bin/env node
/* test/cli-task-e2e.mjs — CLI full-power E2E: `isTask` changes the REAL tool surface.

   test/cli.test.js locks that buildRunBody() sends isTask:true. This test goes end
   to end against the packaged station with a MOCK OpenAI-compatible provider: the
   mock records the `tools` array of every chat request, so we can compare what the
   runtime actually offers:
     A. the real CLI (`starnet -p`) — isTask:true by the locked patch;
     B. a hand-rolled /api/run request with isTask:false (the pre-patch CLI shape).
   The task run must expose the placed headless office (terminal/files/...) that the
   non-task request lacks. No commercial provider tokens are used or needed.

   Usage: cli-task-e2e.mjs <starnet-bin> <starnet-server-bin> */
'use strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const [starnetBin, serverBin] = process.argv.slice(2);
if (!starnetBin || !serverBin) { console.error('FAIL: usage: cli-task-e2e.mjs <starnet-bin> <starnet-server-bin>'); process.exit(2); }

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok - ' + msg); else { failures++; console.error('FAIL - ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- the mock provider: capture tools per request, answer with plain text -------
const requests = []; // { marker, tools: [names] }
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const messages = payload.messages || [];
      const marker = (messages.find(m => m.role === 'user')?.content || '').match(/MARKER-[AB]/)?.[0] || 'unknown';
      requests.push({ marker, tools: (payload.tools || []).map(t => t.function?.name || t.name).filter(Boolean) });
      const text = `echo:${marker}`;
      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
      }
    } catch (e) {
      res.writeHead(400); res.end('{}');
    }
  });
});
await new Promise(r => llm.listen(0, '127.0.0.1', r));
const LLM_PORT = llm.address().port;

// ---- the packaged station with the mock as its custom provider -------------------
const home = mkdtempSync(join(tmpdir(), 'cli-e2e-home-'));
const ws = mkdtempSync(join(tmpdir(), 'cli-e2e-ws-'));
const PORT = 48810;
const station = spawn(serverBin, [], {
  env: { ...process.env, HOME: home, STARNET_PORT: String(PORT), SKYNET_PORT: String(PORT), STARNET_WORKSPACES: ws, CUSTOM_OPENAI_BASE_URL: `http://127.0.0.1:${LLM_PORT}/v1` },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let stationErr = '';
station.stderr.on('data', d => stationErr = (stationErr + d).slice(-2000));
const stationExit = new Promise(r => station.on('exit', c => r(c)));

const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { const r = await fetch(`${base}/api/health`); if (r.status === 200) up = true; } catch (_) {}
  if (!up) await sleep(500);
}
ok(up, 'station healthy with the mock provider configured');

function tokenFromBootstrap(html) {
  const marker = 'window.__STARNET_API_TOKEN__=';
  const at = html.indexOf(marker);
  return JSON.parse(html.slice(at + marker.length).split(';')[0]);
}

try {
  if (up) {
    // A. the REAL CLI against the station (isTask:true per the locked patch)
    const cli = await new Promise((resolve) => {
      const p = spawn(starnetBin, ['-p', 'Say MARKER-A only', '--model', 'mock-model', '--provider', 'custom', '--yes', '--port', String(PORT)], {
        env: { ...process.env, HOME: home, STARNET_WORKSPACES: ws, CUSTOM_OPENAI_BASE_URL: `http://127.0.0.1:${LLM_PORT}/v1` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
      p.on('exit', code => resolve({ code, out, err }));
    });

    // B. the pre-patch shape: the same run body with isTask:false
    const page = await (await fetch(`${base}/`)).text();
    const token = tokenFromBootstrap(page);
    const runB = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-starnet-token': token },
      body: JSON.stringify({
        model: 'mock-model', provider: 'custom', agentId: 'agent',
        messages: [{ role: 'user', content: 'Say MARKER-B only' }],
        isTask: false,
      }),
    });
    ok(runB.status === 200, 'non-task run accepted (' + runB.status + ')');
    await runB.text(); // drain the NDJSON stream
    await sleep(1000);

    const toolsA = requests.find(r => r.marker === 'MARKER-A')?.tools || [];
    const toolsB = requests.find(r => r.marker === 'MARKER-B')?.tools || [];
    ok(toolsA.length > 0, `task run received a real tool surface (${toolsA.length} tools)`);
    ok(cli.code === 0, 'CLI run completed (exit ' + cli.code + (cli.code ? '; stderr: ' + cli.err.slice(-300) : '') + ')');
    const onlyInTask = toolsA.filter(t => !toolsB.includes(t));
    ok(onlyInTask.length > 0, `task surface exceeds the non-task surface (+${onlyInTask.length}: ${onlyInTask.slice(0, 6).join(', ')}${onlyInTask.length > 6 ? ', …' : ''})`);
  }
} finally {
  station.kill('SIGTERM');
  llm.close();
  await Promise.race([stationExit, sleep(5000)]);
}
process.exit(failures ? 1 : 0);
