{ lib
, buildNpmPackage
, nodejs_22
, makeWrapper
, bash
, coreutils
, findutils
, git
, gnugrep
, gnused
, lsof
, procps
, which
, python3
, pkg-config
}:

buildNpmPackage rec {
  pname = "starnet";
  version = "0.13.3";

  src = lib.cleanSource ../.;

  nodejs = nodejs_22;

  # Fixed from GitHub Actions against this dependency graph. The v0.13.3
  # security release changes package metadata but not npm dependencies.
  npmDepsHash = "sha256-u1GWHAC8CGxwg6KIqwQLxudWRkA0HXarla/JP3nXLe8=";

  # Keep the Nix build network-pure. CPU ONNX remains available from the npm
  # closure; optional CUDA/TensorRT provider downloads are intentionally skipped.
  ONNXRUNTIME_NODE_INSTALL = "skip";
  ONNXRUNTIME_NODE_INSTALL_CUDA = "skip";

  dontNpmBuild = true;

  nativeBuildInputs = [
    makeWrapper
    python3
    pkg-config
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/starnet" "$out/bin"
    cp -R . "$out/lib/starnet/"

    runtime_path=${lib.makeBinPath [
      bash
      coreutils
      findutils
      git
      gnugrep
      gnused
      lsof
      procps
      which
    ]}

    makeWrapper ${nodejs_22}/bin/node "$out/bin/starnet-server" \
      --add-flags "$out/lib/starnet/sidecar/index.js" \
      --prefix PATH : "$runtime_path"

    makeWrapper ${nodejs_22}/bin/node "$out/bin/starnet" \
      --add-flags "$out/lib/starnet/bin/starnet.js" \
      --prefix PATH : "$runtime_path"

    runHook postInstall
  '';

  meta = {
    description = "Local-first gamified harness for real AI-agent teams";
    homepage = "https://github.com/androoAGI/starnet";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
    mainProgram = "starnet";
  };
}
