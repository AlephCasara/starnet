{ lib
, stdenv
, rustPlatform
, nodejs_22
, pkg-config
, wrapGAppsHook4
, makeWrapper
, webkitgtk_4_1
, glib-networking
, libayatana-appindicator
, openssl
, starnet ? null
}:

let
  runtime = if starnet != null then starnet else throw "starnet-desktop requires the canonical starnet runtime package";
in
rustPlatform.buildRustPackage rec {
  pname = "starnet-desktop";
  version = "0.13.3";

  src = lib.cleanSource ../.;
  cargoRoot = "src-tauri";
  buildAndTestSubdir = cargoRoot;

  # Intentionally starts as a fixed-output assertion. CI prints the real hash
  # when Cargo.lock changes; the downstream never vendors crates from the network.
  cargoHash = "sha256-ZsCYkwezQQtNceQ6F0DnM7yl/C70/+bp295s17Dr/rE=";

  nativeBuildInputs = [
    nodejs_22
    pkg-config
    wrapGAppsHook4
    makeWrapper
  ];

  buildInputs = [
    webkitgtk_4_1
    glib-networking
    libayatana-appindicator
    openssl
  ];

  # Tauri embeds HTML/JS/CSS at compile time. The staging script is pure local
  # filesystem work: it removes review/source art from the embedded closure and
  # produces frontend-embed/loose-assets.json. No npm install/network is needed.
  # preBuild runs with cwd = the unpacked source root (buildRustPackage only
  # cds into buildAndTestSubdir after preBuild), so a plain relative path is
  # correct; neither `pushd ..` nor a `$sourceRoot/` prefix resolves there.
  #
  # build.rs also validates the declared bundle inputs: `externalBin`
  # ("binaries/node" + target triple) and the `voice-deps/node_modules`
  # resource. The dev flow materializes both from npm downloads
  # (scripts/prepare-node.mjs / stage-voice-deps.mjs); in the sandbox they are
  # symlinked from the canonical runtime closure instead, keeping the build
  # network-pure and the node_modules tree single-sourced.
  preBuild = ''
    ${nodejs_22}/bin/node scripts/stage-frontend-dist.mjs
    mkdir -p src-tauri/binaries src-tauri/voice-deps
    ln -sfn ${nodejs_22}/bin/node "src-tauri/binaries/node-${stdenv.hostPlatform.rust.rustcTargetSpec}"
    ln -sfn ${runtime}/lib/starnet/node_modules src-tauri/voice-deps/node_modules
  '';

  # Tauri tray support dlopens libayatana-appindicator by SONAME. Point the
  # vendored sys crate at the store path, following current nixpkgs Tauri practice.
  postPatch = ''
    if compgen -G "$cargoDepsCopy/*/libappindicator-sys-*/src/lib.rs" > /dev/null; then
      substituteInPlace $cargoDepsCopy/*/libappindicator-sys-*/src/lib.rs \
        --replace-fail "libayatana-appindicator3.so.1" "${libayatana-appindicator}/lib/libayatana-appindicator3.so.1"
    fi
  '';

  # These tests are pure Rust/unit tests and exercise the attach parser/token
  # bootstrap in addition to upstream desktop invariants. WebKit is present in
  # the build closure, but no graphical session is required for cargo test.
  doCheck = true;

  postInstall = ''
    # Cargo package name remains upstream's `skynet-desktop`; expose the product
    # name downstream without changing Cargo metadata and creating merge churn.
    if [ -e "$out/bin/skynet-desktop" ]; then
      mv "$out/bin/skynet-desktop" "$out/bin/starnet-desktop"
    fi

    # The Rust shell discovers release resources beside its executable before it
    # falls back to Tauri's bundle resource directory. Reuse the canonical runtime
    # closure instead of copying a second sidecar/frontend/node_modules tree.
    ln -s ${runtime}/lib/starnet/sidecar "$out/bin/sidecar"
    ln -s ${runtime}/lib/starnet/frontend "$out/bin/frontend"
    ln -s ${runtime}/lib/starnet/shared "$out/bin/shared"
    ln -s ${runtime}/lib/starnet/node_modules "$out/bin/node_modules"
    mkdir -p "$out/bin/binaries"
    ln -s ${nodejs_22}/bin/node "$out/bin/binaries/node-${stdenv.hostPlatform.rust.rustcTargetSpec}"
  '';

  meta = {
    description = "StarNet Tauri/WebKitGTK desktop shell for Linux";
    homepage = "https://github.com/androoAGI/starnet";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
    mainProgram = "starnet-desktop";
  };
}
