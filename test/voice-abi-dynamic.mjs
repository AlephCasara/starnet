#!/usr/bin/env node
/* test/voice-abi-dynamic.mjs — dynamic ONNX ABI isolation inside the packaged runtime.

   The structural test (test/desktop-voice-bundle.test.js) proves the SONAME rewrite
   on synthetic trees; this test loads the REAL prepared runtimes from the nix-built
   starnet package in ONE process, in sequence:
     1. the Transformers onnxruntime-node (top-level copy),
     2. the Kokoro nested onnxruntime-node,
   and asserts both native bindings initialize and that the two distinct
   version-qualified libstarnet-onnxruntime-*.so images are mapped at the same
   time. Without the isolation both copies would claim libonnxruntime.so.1 and
   the second binding would resolve against the first runtime's symbols.

   Usage: voice-abi-dynamic.mjs <starnet-runtime-node_modules-path> */
'use strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const nmRoot = process.argv[2];
if (!nmRoot) { console.error('FAIL: usage: voice-abi-dynamic.mjs <packaged node_modules>'); process.exit(2); }

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok - ' + msg); else { failures++; console.error('FAIL - ' + msg); } };

const req = createRequire(nmRoot + '/package.json');

// 1. Transformers path first (whichever runtime loads first would own the plain SONAME).
let ortTransformers = null, ortKokoro = null;
try {
  ortTransformers = req(`${nmRoot}/onnxruntime-node`);
  ok(typeof ortTransformers.InferenceSession === 'function', 'transformers onnxruntime-node binding loaded');
} catch (e) { ok(false, 'transformers onnxruntime-node binding loaded: ' + e.message); }

// 2. Kokoro's nested copy in the SAME process.
try {
  ortKokoro = req(`${nmRoot}/kokoro-js/node_modules/onnxruntime-node`);
  ok(typeof ortKokoro.InferenceSession === 'function', 'kokoro nested onnxruntime-node binding loaded in the same process');
} catch (e) { ok(false, 'kokoro nested binding loaded: ' + e.message); }

// 3. Both qualified runtimes must be mapped simultaneously, and no plain libonnxruntime.so.1.
const maps = readFileSync('/proc/self/maps', 'utf8');
const mapped = [...new Set((maps.match(/libstarnet-onnxruntime-[0-9.]+\.so\.[0-9]+/g) || []))];
ok(mapped.length >= 2, `both isolated runtimes mapped together (${mapped.join(', ')})`);
ok(!/libonnxruntime\.so\.1/.test(maps), 'no un-namespaced libonnxruntime.so.1 was mapped');

// 4. The two InferenceSession constructors are distinct module instances.
if (ortTransformers && ortKokoro) {
  ok(ortTransformers.InferenceSession !== ortKokoro.InferenceSession, 'the two bindings stay distinct module instances');
}

process.exit(failures ? 1 : 0);
