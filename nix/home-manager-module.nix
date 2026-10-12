{ config, lib, pkgs, ... }:

let
  cfg = config.services.starnet;
  inherit (lib) mkEnableOption mkIf mkOption optionalAttrs types;

  rawClaudeCommand =
    if cfg.claudePackage != null then "${cfg.claudePackage}/bin/claude"
    else cfg.claudeCommand;

  # StarNet's upstream claude-cli provider uses `claude auth status` as a
  # readiness probe. A host can instead authenticate Claude Code through an
  # enforced managed-settings apiKeyHelper (for example an Anthropic-compatible
  # coding plan) while `auth status` still reports signed out. In that one mode
  # we bridge ONLY the readiness probe; every real invocation is exec'd into the
  # host's Claude Code binary unchanged. No credential is read or copied here.
  effectiveClaudeCommand =
    if rawClaudeCommand == null then null
    else if cfg.claudeExternalManagedAuth then
      pkgs.writeShellScript "starnet-claude-bridge" ''
        if [ "$#" -ge 2 ] && [ "$1" = "auth" ] && [ "$2" = "status" ]; then
          printf '%s\n' '{"loggedIn":true,"authMethod":"external-managed"}'
          exit 0
        fi
        exec ${lib.escapeShellArg rawClaudeCommand} "$@"
      ''
    else
      rawClaudeCommand;

  hermesCommand =
    if cfg.hermes.package != null then "${cfg.hermes.package}/bin/hermes"
    else cfg.hermes.command;

  starnetEnvironment =
    {
      STARNET_PORT = toString cfg.port;
      SKYNET_PORT = toString cfg.port;
    }
    // optionalAttrs (effectiveClaudeCommand != null) {
      STARNET_CLAUDE_BIN = toString effectiveClaudeCommand;
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
      description = "Optional Claude Code package. Takes precedence over claudeCommand.";
    };

    claudeCommand = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "/run/current-system/sw/bin/claude";
      description = "Existing absolute Claude Code executable to expose to StarNet when no claudePackage is supplied.";
    };

    claudeExternalManagedAuth = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Treat the local Claude Code CLI as ready when authentication is supplied
        by host-managed settings/apiKeyHelper rather than Claude's own login.
        Only `claude auth status` is bridged; all model turns execute the real
        Claude Code binary unchanged. Do not enable for subscription stacking.
      '';
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
        description = "Optional Hermes Agent package. Takes precedence over hermes.command.";
      };

      command = mkOption {
        type = types.str;
        default = "${config.home.profileDirectory}/bin/hermes";
        defaultText = lib.literalExpression ''"${config.home.profileDirectory}/bin/hermes"'';
        description = "Existing Hermes executable. Defaults to the Hermes already installed in the Home Manager profile.";
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
        assertion = !cfg.claudeExternalManagedAuth || rawClaudeCommand != null;
        message = "services.starnet needs claudePackage or claudeCommand when claudeExternalManagedAuth = true";
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
          ExecStart = "${hermesCommand} proxy start --provider ${cfg.hermes.provider} --host 127.0.0.1 --port ${toString cfg.hermes.port}";
          Restart = "on-failure";
          RestartSec = 2;
          Environment = lib.mapAttrsToList (name: value: "${name}=${toString value}") cfg.hermes.environment;
        };

        Install.WantedBy = [ "default.target" ];
      };
    };
  };
}
