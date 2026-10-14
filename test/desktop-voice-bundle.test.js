'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const infoPlist = read('src-tauri/Info.plist');
const stage = read('scripts/stage-voice-deps.mjs');
const linuxNative = read('scripts/prepare-linux-native.mjs');
const buildRs = read('src-tauri/build.rs');
const desktopCi = read('.github/workflows/desktop-build.yml');
const releaseCi = read('.github/workflows/release-train.yml');
const canary = read('scripts/update-canary.mjs');
const phase5Surface = read('scripts/phase5-surface-proof.mjs');

assert.equal(
  pkg.dependencies['ogg-opus-decoder'],
  '^1.7.3',
  'the packaged sidecar carries an in-process Telegram Ogg/Opus decoder'
);
assert.equal(pkg.overrides && pkg.overrides.sharp, '0.35.4',
  'both Transformers copies are forced onto the patched Sharp runtime');
const lockedSharp = Object.entries(lock.packages || {})
  .filter(([name]) => /(?:^|\/)node_modules\/sharp$/.test(name))
  .map(([, meta]) => meta && meta.version);
assert.ok(lockedSharp.length > 0 && lockedSharp.every(version => version === '0.35.4'),
  'the lockfile cannot restore a Sharp runtime affected by GHSA-rgj7-g3m4-5g8c');

assert.match(
  pkg.scripts['desktop:build'],
  /prepare-node\.mjs[\s\S]*stage-voice-deps\.mjs[\s\S]*tauri build/,
  'a local desktop build stages the voice runtime before Tauri packages resources'
);
assert.equal(
  tauri.bundle.resources['voice-deps/node_modules'],
  'node_modules',
  'the staged runtime lands beside sidecar/ so ordinary Node resolution finds it'
);
assert.match(buildRs, /"voice-deps\/node_modules"/, 'Cargo treats the staged voice runtime as a shipped build input');

// WKWebView getUserMedia reaches the macOS microphone privacy boundary. Tauri merges
// src-tauri/Info.plist into the generated application bundle, and macOS refuses capture
// when this purpose string is absent. Keep the permission declaration coupled to the
// offline voice runtime so a packaged Mac build cannot silently ship a dead microphone.
assert.match(
  infoPlist,
  /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*(?:microphone|voice)[^<]*<\/string>/i,
  'the macOS app bundle declares why StarNet requests microphone access'
);
assert.equal(tauri.bundle.macOS.hardenedRuntime, true);
assert.equal(tauri.bundle.macOS.entitlements, 'entitlements.plist');
assert.match(fs.readFileSync(path.join(root, 'src-tauri', tauri.bundle.macOS.entitlements), 'utf8'),
  /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\s*\/>/,
  'signed macOS builds authorize microphone input under hardened runtime');

for (const [name, source] of [['desktop CI', desktopCi], ['release CI', releaseCi]]) {
  assert.match(
    source,
    /prepare-node\.mjs \$\{\{ matrix\.target \}\}[\s\S]{0,160}stage-voice-deps\.mjs --target \$\{\{ matrix\.target \}\}/,
    name + ' stages the matching platform/architecture voice runtime'
  );
}
assert.match(canary, /stage-voice-deps\.mjs'\), '--target', 'win-x64'/, 'canary installers ship the same Windows voice engine');
assert.match(
  phase5Surface,
  /prepare-node\.mjs'[\s\S]*stage-voice-deps\.mjs --target win-x64'[\s\S]*tauri\) \+ ' build'/,
  'the Windows desktop evidence runner stages the native voice closure before its direct Tauri build'
);

assert.match(stage, /\^\(win\|darwin\|linux\)-\(x64\|arm64\)\$/, 'the staging script validates release target names');
assert.match(stage, /pruneOnnxBinaries\(dest\)/, 'foreign ONNX native binaries are removed from the staged closure');
assert.match(stage, /prepareLinuxNative\(dest, PLATFORM, ARCH\)/, 'Linux staging isolates incompatible ONNX ABIs after platform pruning');
assert.match(stage, /if \(!pruned\.kept\.length\)/, 'the build fails closed when no target ONNX runtime survives');
assert.match(stage, /for \(const dep of runtimeDeps\)/, 'every declared production dependency must exist in the staged tree');
assert.match(stage, /DROP_ANYWHERE = new Set\(\['onnxruntime-web', 'adm-zip'\]\)/, 'browser ONNX and the build-only ZIP downloader are not shipped in the Node sidecar bundle');
assert.match(stage, /build-only adm-zip leaked into the shipped runtime closure/, 'the build fails closed if the vulnerable postinstall-only ZIP package survives staging');
assert.match(stage, /function purgeStaleReleasePackages\(\)/, 'warm Tauri outputs are purged so removed packages cannot survive in a later installer');
assert.match(stage, /libonnxruntime\\\.so\\\.1/, 'warm Linux outputs purge the pre-isolation ONNX SONAME');
assert.match(stage, /OUT === resolve\(join\(ROOT, 'src-tauri', 'voice-deps'\)\)/, 'stale-output purging is limited to the real desktop staging path');
assert.match(linuxNative, /libstarnet-onnxruntime-\$\{version\}\.so\.1/, 'each Linux ONNX ABI gets a version-qualified StarNet SONAME');
assert.match(linuxNative, /--replace-needed/, 'the native binding is retargeted to its isolated runtime');

const { isUnusedMuslSharp, isUnusedDesktopAccelerator } = require('../scripts/lib/staged-native-packages.mjs');
assert.equal(isUnusedMuslSharp('@img', 'sharp-linuxmusl-x64', 'linux'), true, 'glibc AppImage excludes the musl addon that linuxdeploy cannot load');
assert.equal(isUnusedMuslSharp('@img', 'sharp-libvips-linuxmusl-x64', 'linux'), true, 'the unused musl libvips companion is removed too');
assert.equal(isUnusedMuslSharp('@img', 'sharp-linuxmusl-arm64', 'linux'), true, 'glibc ARM has the same libc boundary');
for (const name of ['sharp-linux-x64', 'sharp-libvips-linux-x64', 'sharp-linux-arm64', 'sharp-libvips-linux-arm64', 'sharp-libvips-dev']) {
  assert.equal(isUnusedMuslSharp('@img', name, 'linux'), false, 'required glibc and non-platform Sharp packages survive: ' + name);
}
assert.equal(isUnusedMuslSharp('unrelated', 'sharp-linuxmusl-x64', 'linux'), false, 'only the native @img scope is pruned');
for (const platform of ['darwin', 'win32']) assert.equal(isUnusedMuslSharp('@img', 'sharp-linuxmusl-x64', platform), false, 'other desktop targets retain their existing staging behavior');
const ort = '/bundle/node_modules/kokoro-js/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/';
for (const backend of ['cuda', 'tensorrt']) assert.equal(isUnusedDesktopAccelerator(ort + 'libonnxruntime_providers_' + backend + '.so', 'linux'), true, 'CPU-only voice does not ship optional ' + backend + ' dependencies');
for (const name of ['libonnxruntime.so.1', 'libonnxruntime_providers_shared.so', 'onnxruntime_binding.node']) assert.equal(isUnusedDesktopAccelerator(ort + name, 'linux'), false, 'CPU runtime remains intact: ' + name);
assert.equal(isUnusedDesktopAccelerator('/other/libonnxruntime_providers_cuda.so', 'linux'), false, 'an unrelated project file is not a pruning target');
assert.equal(isUnusedDesktopAccelerator(ort + 'libonnxruntime_providers_cuda.so', 'win32'), false, 'Windows staging is unchanged');
console.log('desktop voice bundle tests passed');

const { isDevelopmentOnlyPackage } = require('../scripts/lib/staged-native-packages.mjs');
for (const name of ['canvas','canvas-linux-x64-musl','canvas-linux-x64-gnu','canvas-win32-x64-msvc']) {
  assert.equal(isDevelopmentOnlyPackage('node_modules/@napi-rs/'+name, lock.packages), true, 'development-only canvas stays out of every desktop bundle: '+name);
}
const fixtures={'node_modules/dev':{dev:true},'node_modules/shared':{},'node_modules/optional':{devOptional:true},'node_modules/prod/node_modules/dev':{dev:true}};
assert.equal(isDevelopmentOnlyPackage('node_modules\\dev',fixtures),true);
assert.equal(isDevelopmentOnlyPackage('node_modules/prod/node_modules/dev',fixtures),true);
for(const name of ['shared','optional','unknown'])assert.equal(isDevelopmentOnlyPackage('node_modules/'+name,fixtures),false);
for(const dep of Object.keys(pkg.dependencies))assert.equal(isDevelopmentOnlyPackage('node_modules/'+dep,lock.packages),false,'production root preserved: '+dep);
assert.match(stage,/filter: source => !isDevelopmentOnlyPackage/, 'fresh staging filters development closure');
assert.match(stage,/relative\(packageRoot, childPath\)/, 'warm outputs use the same lockfile package identity');
console.log('desktop staging: development-only native packages excluded, production/shared/optional packages preserved');

// Exercise the Linux ABI isolator without requiring a real ELF or host patchelf.
// The injected patchelf seam models SONAME/DT_NEEDED state while the test uses
// the real filesystem rename/idempotence behavior.
void import('../scripts/prepare-linux-native.mjs').then(({ prepareLinuxNative }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-onnx-isolation-'));
  const sonames = new Map();
  const needed = new Map();
  const roots = [
    ['node_modules/onnxruntime-node', '1.24.3'],
    ['node_modules/kokoro-js/node_modules/onnxruntime-node', '1.21.0']
  ];
  for (const [rel, version] of roots) {
    const pkgRoot = path.join(tmp, rel);
    const native = path.join(pkgRoot, 'bin', 'napi-v3', 'linux', 'x64');
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(native, 'libonnxruntime.so.1'), 'runtime-' + version);
    fs.writeFileSync(path.join(native, 'onnxruntime_binding.node'), 'binding-' + version);
  }
  const fakePatchelf = (...args) => {
    const op = args[0];
    if (op === '--version') return 'patchelf fake';
    if (op === '--print-soname') return sonames.get(args[1]) || 'libonnxruntime.so.1';
    if (op === '--set-soname') { sonames.set(args[2], args[1]); return ''; }
    if (op === '--print-needed') return (needed.get(args[1]) || ['libonnxruntime.so.1', 'libc.so.6']).join('\n');
    if (op === '--replace-needed') {
      const current = needed.get(args[3]) || ['libonnxruntime.so.1', 'libc.so.6'];
      needed.set(args[3], current.map(name => name === args[1] ? args[2] : name));
      return '';
    }
    throw new Error('unexpected fake patchelf operation: ' + args.join(' '));
  };
  try {
    const prepared = prepareLinuxNative(tmp, 'linux', 'x64', fakePatchelf);
    assert.equal(prepared.length, 2, 'both incompatible ONNX runtimes are isolated');
    assert.notEqual(prepared[0].soname, prepared[1].soname, 'different ABI versions cannot share a SONAME');
    for (const item of prepared) {
      assert.ok(fs.existsSync(item.library), 'version-qualified ONNX library exists: ' + item.soname);
      assert.ok(!fs.existsSync(path.join(item.native, 'libonnxruntime.so.1')), 'ambiguous SONAME file was removed');
      assert.ok((needed.get(item.binding) || []).includes(item.soname), 'binding points at its version-qualified runtime');
    }
    assert.equal(prepareLinuxNative(tmp, 'linux', 'x64', fakePatchelf).length, 2, 'preparation is idempotent on an already-isolated tree');
    let touched = false;
    assert.deepEqual(prepareLinuxNative(tmp, 'darwin', 'x64', () => { touched = true; }), [], 'non-Linux platforms remain untouched');
    assert.equal(touched, false, 'non-Linux path never invokes patchelf');
    console.log('Linux ONNX ABI isolation tests passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
