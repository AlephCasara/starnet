#!/usr/bin/env node
// Linux loads DSOs with the same SONAME as one process-wide identity. StarNet's
// offline voice stack currently contains two different onnxruntime-node ABIs
// (Transformers and Kokoro), and both ship libonnxruntime.so.1. Give each copy
// a version-qualified SONAME and point its binding at that name so ASR and TTS
// cannot accidentally bind to whichever runtime was loaded first.
//
// Design adapted from the MIT-licensed mvalancy/starnet-linux implementation
// in commit e8d7a7abeed90fff6cde06adea80630846fb11b1, re-applied against v0.13.3.
import { existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function prepareLinuxNative(root, platform = process.platform, arch = process.arch, runPatchelf = null) {
  if (platform !== 'linux') return [];
  const patch = runPatchelf || ((...args) => execFileSync('patchelf', args, { encoding: 'utf8' }).trim());
  patch('--version'); // Fail before renaming anything when the build prerequisite is missing.
  const prepared = [];

  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name !== 'onnxruntime-node') {
        visit(child);
        continue;
      }

      const { version } = JSON.parse(readFileSync(join(child, 'package.json'), 'utf8'));
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Unrecognized ONNX runtime version: ${version}`);
      }

      const bin = join(child, 'bin');
      if (!existsSync(bin)) continue;
      for (const napi of readdirSync(bin)) {
        const native = join(bin, napi, 'linux', arch);
        const binding = join(native, 'onnxruntime_binding.node');
        if (!existsSync(binding)) continue;

        const original = 'libonnxruntime.so.1';
        const unique = `libstarnet-onnxruntime-${version}.so.1`;
        const originalLibrary = join(native, original);
        const library = join(native, unique);
        if (!existsSync(library)) {
          if (!existsSync(originalLibrary)) {
            throw new Error(`Missing ONNX runtime library beside binding: ${native}`);
          }
          renameSync(originalLibrary, library);
        }

        if (patch('--print-soname', library) !== unique) {
          patch('--set-soname', unique, library);
        }
        if (patch('--print-needed', binding).split('\n').includes(original)) {
          patch('--replace-needed', original, unique, binding);
        }
        if (!patch('--print-needed', binding).split('\n').includes(unique)) {
          throw new Error(`ONNX binding does not reference its isolated runtime: ${binding}`);
        }
        prepared.push({ version, native, library, binding, soname: unique });
      }
    }
  }

  visit(resolve(root));
  return prepared;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const prepared = prepareLinuxNative(process.argv[2] || 'node_modules');
  if (process.platform === 'linux') {
    console.log(`prepare-linux-native: isolated ${prepared.length} ONNX runtime binding(s)`);
  }
}
