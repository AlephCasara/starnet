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
  version = "0.13.2";

  src = lib.cleanSource ../.;

  nodejs = nodejs_22;

  # Fixed from GitHub Actions against this exact package-lock.json. Any
  # dependency drift now fails closed until the hash is deliberately updated.
  npmDepsHash = "sha256-u1GWHAC8CGxwg6KIqwQLxudWRkA0HXarla/JP3nXLe8=";

  # onnxruntime-node bundles the CPU runtime in the npm package. On linux/x64
  # its install hook additionally downloads the CUDA/TensorRT provider DLLs
  # from NuGet. That is both impure in a Nix sandbox and undesirable on this
  # deployment: StarNet's media helpers must not occupy the primary LLM GPU.
  # This is the package's documented switch; CPU ONNX remains available.
  ONNXRUNTIME_NODE_INSTALL = "skip";

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
