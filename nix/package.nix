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

  # Replace after the first `nix build .#starnet -L`: Nix prints the exact
  # sha256 it computed for package-lock.json. Keeping the fake hash here makes
  # dependency drift fail closed instead of silently using the network.
  npmDepsHash = lib.fakeHash;

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
