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
        in
        {
          package = starnet;
          desktop = starnet-desktop;
          home-manager-module = moduleCheck;
          cli-unit = nodeCheck "starnet-cli-unit" "test/cli.test.js";
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
