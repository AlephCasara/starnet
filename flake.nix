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
        in
        {
          inherit starnet;
          default = starnet;
        });

      checks = forAllSystems (pkgs:
        let
          lib = nixpkgs.lib;
          starnet = self.packages.${pkgs.stdenv.hostPlatform.system}.starnet;

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
        in
        {
          package = starnet;
          home-manager-module = moduleCheck;
        });

      overlays.default = final: _prev: {
        starnet = final.callPackage ./nix/package.nix { };
      };

      homeManagerModules.default = import ./nix/home-manager-module.nix;
      homeManagerModules.starnet = self.homeManagerModules.default;
    };
}
