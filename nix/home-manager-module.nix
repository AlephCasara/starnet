{ config, lib, pkgs, ... }:

let
  cfg = config.services.starnet;
  inherit (lib) mkEnableOption mkIf mkOption optionalAttrs types;

  starnetEnvironment =
    {
      STARNET_PORT = toString cfg.port;
      SKYNET_PORT = toString cfg.port;
    }
    // optionalAttrs (cfg.claudePackage != null) {
      STARNET_CLAUDE_BIN = "${cfg.claudePackage}/bin/claude";
    }
    // optionalAttrs (cfg.hermes.enable && cfg.hermes.exposeAsCustomProvider) {
      CUSTOM_OPENAI_BASE_URL = "http://127.0.0.1:${toString cfg.hermes.port}/v1";
      OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:${toString cfg.hermes.port}/v1";
    }
    // cfg.environment;

  envList = lib.mapAttrsToList (name: value: "${name}=${toString value}") starnetEnvironment;
in
{
  options.services.starnet = {
    enable = mkEnableOption "StarNet sidecar and web station";

    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./package.nix { }";
      description = "StarNet package to run.";
    };

    port = mkOption {
      type = types.port;
      default = 8787;
      description = "Loopback port used by the StarNet sidecar.";
    };

    claudePackage = mkOption {
      type = types.nullOr types.package;
      default = null;
      description = "Optional Claude Code package. When set, STARNET_CLAUDE_BIN points at its claude executable.";
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      description = "Additional environment variables passed to the StarNet user service.";
    };

    hermes = {
      enable = mkEnableOption "the Hermes OpenAI-compatible proxy next to StarNet";

      package = mkOption {
        type = types.nullOr types.package;
        default = null;
        description = "Hermes Agent package providing the hermes CLI.";
      };

      provider = mkOption {
        type = types.enum [ "nous" "xai" ];
        default = "nous";
        description = "Hermes OAuth-backed upstream exposed by hermes proxy.";
      };

      port = mkOption {
        type = types.port;
        default = 8645;
        description = "Loopback port for hermes proxy.";
      };

      exposeAsCustomProvider = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Point StarNet's generic Custom OpenAI-compatible provider environment at
          the Hermes proxy. Leave false if the custom slot is already used for a
          local llama.cpp/vLLM/router endpoint; the proxy can still be configured
          manually inside StarNet.
        '';
      };

      environment = mkOption {
        type = types.attrsOf types.str;
        default = { };
        description = "Additional environment variables passed only to hermes proxy.";
      };
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !cfg.hermes.enable || cfg.hermes.package != null;
        message = "services.starnet.hermes.package must be set when services.starnet.hermes.enable = true";
      }
    ];

    home.packages = [ cfg.package ];

    systemd.user.services = {
      starnet = {
        Unit = {
          Description = "StarNet local AI-agent station";
          After = [ "network.target" ] ++ lib.optional cfg.hermes.enable "starnet-hermes-proxy.service";
          Wants = lib.optional cfg.hermes.enable "starnet-hermes-proxy.service";
        };

        Service = {
          ExecStart = "${cfg.package}/bin/starnet-server";
          Restart = "on-failure";
          RestartSec = 2;
          Environment = envList;
        };

        Install.WantedBy = [ "default.target" ];
      };
    }
    // optionalAttrs cfg.hermes.enable {
      starnet-hermes-proxy = {
        Unit = {
          Description = "Hermes OAuth OpenAI-compatible proxy for StarNet";
          After = [ "network.target" ];
        };

        Service = {
          ExecStart = "${cfg.hermes.package}/bin/hermes proxy start --provider ${cfg.hermes.provider} --host 127.0.0.1 --port ${toString cfg.hermes.port}";
          Restart = "on-failure";
          RestartSec = 2;
          Environment = lib.mapAttrsToList (name: value: "${name}=${toString value}") cfg.hermes.environment;
        };

        Install.WantedBy = [ "default.target" ];
      };
    };
  };
}
