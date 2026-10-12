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

      checks = forAllSystems (pkgs: {
        package = self.packages.${pkgs.stdenv.hostPlatform.system}.starnet;
      });

      overlays.default = final: _prev: {
        starnet = final.callPackage ./nix/package.nix { };
      };

      homeManagerModules.default = import ./nix/home-manager-module.nix;
      homeManagerModules.starnet = self.homeManagerModules.default;
    };
}
