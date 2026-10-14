{
  description = "StarNet local-first agent harness with NixOS packaging";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      packages = forAllSystems (pkgs:
        let
          starnet = pkgs.callPackage ./nix/package.nix { };
          starnet-desktop = pkgs.callPackage ./nix/desktop.nix { inherit starnet; };
        in
        {
          inherit starnet starnet-desktop;
          default = starnet;
        });

      checks = forAllSystems (pkgs:
        let
          lib = nixpkgs.lib;
          starnet = self.packages.${pkgs.stdenv.hostPlatform.system}.starnet;
          starnet-desktop = self.packages.${pkgs.stdenv.hostPlatform.system}.starnet-desktop;

          moduleEval = lib.evalModules {
            specialArgs = { inherit pkgs; };
            modules = [
              ({ lib, ... }: {
                options = {
                  home.profileDirectory = lib.mkOption {
                    type = lib.types.str;
                    default = "/home/starnet-test/.nix-profile";
                  };
                  home.packages = lib.mkOption {
                    type = lib.types.listOf lib.types.package;
                    default = [ ];
                  };
                  systemd.user.services = lib.mkOption {
                    type = lib.types.attrsOf lib.types.anything;
                    default = { };
                  };
                  assertions = lib.mkOption {
                    type = lib.types.listOf lib.types.anything;
                    default = [ ];
                  };
                };
              })

              self.homeManagerModules.starnet

              {
                services.starnet = {
                  enable = true;
                  package = starnet;
                  claudeCommand = "/bin/false";
                  claudeExternalManagedAuth = true;
                  hermes = {
                    enable = true;
                    command = "/bin/false";
                    provider = "nous";
                    port = 8645;
                    exposeAsCustomProvider = false;
                  };
                };
              }
            ];
          };

          moduleServices = moduleEval.config.systemd.user.services;
          moduleAssertionsPass = builtins.all (a: a.assertion) moduleEval.config.assertions;
          moduleCheck =
            assert moduleAssertionsPass;
            assert builtins.hasAttr "starnet" moduleServices;
            assert builtins.hasAttr "starnet-hermes-proxy" moduleServices;
            assert lib.hasPrefix "${starnet}/bin/starnet-server" moduleServices.starnet.Service.ExecStart;
            pkgs.runCommand "starnet-home-manager-module-eval" { } ''
              touch "$out"
            '';

          nodeCheck = name: script: pkgs.runCommand name {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            export HOME="$TMPDIR/home"
            mkdir -p "$HOME"
            cd ${self}
            node ${script}
            touch "$out"
          '';

          # The desktop shell must ship exactly the resources the Rust runtime
          # resolves beside its executable (sidecar, frontend, shared,
          # node_modules, externalBin node) and must share the runtime
          # package's mutable-free closure instead of copying a second,
          # divergent dependency tree.
          desktopClosure = pkgs.runCommand "starnet-desktop-closure" { } ''
            set -eu
            bin="${starnet-desktop}/bin"
            test -x "$bin/starnet-desktop" || { echo "FAIL: starnet-desktop executable missing"; exit 1; }
            for resource in sidecar frontend shared node_modules; do
              test -e "$bin/$resource" || { echo "FAIL: required resource $resource missing"; exit 1; }
            done
            shopt -s nullglob
            nodes=("$bin"/binaries/node-*)
            test ''${#nodes[@]} -gt 0 || { echo "FAIL: externalBin node-<triple> missing"; exit 1; }
            for node in "''${nodes[@]}"; do
              test -x "$node" || { echo "FAIL: externalBin $node not executable"; exit 1; }
            done
            runtime_root="${starnet}/lib/starnet"
            for resource in sidecar frontend shared node_modules; do
              desktop_real="$(readlink -f "$bin/$resource")"
              runtime_real="$(readlink -f "$runtime_root/$resource")"
              test "$desktop_real" = "$runtime_real" || {
                echo "FAIL: $resource diverges between desktop and runtime closure"
                echo "  desktop: $desktop_real"
                echo "  runtime: $runtime_real"
                exit 1
              }
            done
            touch "$out"
          '';
        in
        {
          package = starnet;
          desktop = starnet-desktop;
          desktop-closure = desktopClosure;
          home-manager-module = moduleCheck;
          cli-unit = nodeCheck "starnet-cli-unit" "test/cli.test.js";
          desktop-external-ownership = nodeCheck "starnet-desktop-external-ownership" "test/desktop-external-ownership.test.js";
          desktop-voice-bundle = nodeCheck "starnet-desktop-voice-bundle" "test/desktop-voice-bundle.test.js";
        });

      overlays.default = final: _prev:
        let
          starnet = final.callPackage ./nix/package.nix { };
        in
        {
          inherit starnet;
          starnet-desktop = final.callPackage ./nix/desktop.nix { inherit starnet; };
        };

      homeManagerModules.default = import ./nix/home-manager-module.nix;
      homeManagerModules.starnet = self.homeManagerModules.default;
    };
}
