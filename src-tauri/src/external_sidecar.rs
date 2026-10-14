//! Desktop attach mode for a StarNet sidecar owned by another process supervisor.
//!
//! The default desktop contract is unchanged: Tauri owns one child sidecar. On Linux/NixOS a
//! canonical station may instead be managed by `systemd --user`. In that mode the shell must attach
//! to the existing loopback station and must never reap, respawn, reset, halt, or kill it.
//!
//! Token discovery deliberately reuses StarNet's existing browser/CLI/MCP/ACP contract: GET `/`
//! and read the master token injected into the page. Since v0.13.3 the sidecar injects that token
//! only after its peer-owner check proves the loopback client belongs to the same OS user. No new
//! token file, secret-bearing Nix option, or trust bypass is introduced here.
use serde::Deserialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const MODE_ENV: &str = "STARNET_DESKTOP_SIDECAR_MODE";
const PORT_ENVS: [&str; 2] = ["STARNET_PORT", "SKYNET_PORT"];
const MAX_BOOTSTRAP_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SidecarOwnership {
    Desktop,
    External,
}

impl SidecarOwnership {
    pub(crate) fn is_desktop(self) -> bool {
        matches!(self, Self::Desktop)
    }

    pub(crate) fn is_external(self) -> bool {
        matches!(self, Self::External)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopSidecarMode {
    Spawn,
    Attach { port: u16 },
}

impl DesktopSidecarMode {
    pub(crate) fn ownership(self) -> SidecarOwnership {
        match self {
            Self::Spawn => SidecarOwnership::Desktop,
            Self::Attach { .. } => SidecarOwnership::External,
        }
    }

    pub(crate) fn fixed_port(self) -> Option<u16> {
        match self {
            Self::Spawn => None,
            Self::Attach { port } => Some(port),
        }
    }

    pub(crate) fn from_process_env() -> Result<Self, String> {
        parse_mode(|name| std::env::var(name).ok())
    }
}

fn parse_mode(mut get: impl FnMut(&str) -> Option<String>) -> Result<DesktopSidecarMode, String> {
    let raw = get(MODE_ENV).unwrap_or_default();
    let mode = raw.trim().to_ascii_lowercase();
    match mode.as_str() {
        "" | "spawn" | "managed" | "desktop" => Ok(DesktopSidecarMode::Spawn),
        "attach" | "external" | "existing" => {
            let (name, raw_port) = PORT_ENVS
                .iter()
                .find_map(|name| get(name).map(|value| (*name, value)))
                .ok_or_else(|| {
                    format!(
                        "{MODE_ENV}={mode} requires STARNET_PORT (or legacy SKYNET_PORT)"
                    )
                })?;
            let port = raw_port.trim().parse::<u16>().map_err(|_| {
                format!("{name} must be an integer from 1 to 65535 for desktop attach mode")
            })?;
            if port == 0 {
                return Err(format!(
                    "{name} must be an integer from 1 to 65535 for desktop attach mode"
                ));
            }
            Ok(DesktopSidecarMode::Attach { port })
        }
        other => Err(format!(
            "unsupported {MODE_ENV}={other:?}; expected spawn or attach"
        )),
    }
}

/// Parse the token StarNet already injects into its same-user browser bootstrap page.
/// This accepts a JSON string literal rather than assuming the token contains no escapes.
pub(crate) fn token_from_bootstrap_html(html: &str) -> Result<String, String> {
    const TOKEN_MARKER: &str = "window.__STARNET_API_TOKEN__=";
    const WITHHELD_MARKER: &str = "window.__STARNET_TOKEN_WITHHELD__=";

    if let Some(start) = html.find(TOKEN_MARKER) {
        let mut de = serde_json::Deserializer::from_str(&html[start + TOKEN_MARKER.len()..]);
        let token = String::deserialize(&mut de)
            .map_err(|e| format!("station bootstrap token is malformed: {e}"))?;
        if token.is_empty() {
            return Err("station bootstrap returned an empty API token".to_string());
        }
        return Ok(token);
    }

    if let Some(start) = html.find(WITHHELD_MARKER) {
        let mut de = serde_json::Deserializer::from_str(&html[start + WITHHELD_MARKER.len()..]);
        let reason = String::deserialize(&mut de).unwrap_or_else(|_| "peer-owner-check".to_string());
        return Err(format!(
            "station withheld its API token ({reason}); desktop attach remains fail-closed"
        ));
    }

    Err("the target did not expose a StarNet bootstrap token".to_string())
}

/// Discover the external station token over loopback. The sidecar's v0.13.3 peer-owner check is
/// the authorization boundary: this Rust process must resolve to the same OS user as the station.
pub(crate) fn discover_token(port: u16, timeout: Duration) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|e| format!("cannot attach to StarNet on 127.0.0.1:{port}: {e}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("cannot set attach read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("cannot set attach write timeout: {e}"))?;

    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.flush())
        .map_err(|e| format!("cannot request StarNet bootstrap page: {e}"))?;

    let mut bytes = Vec::with_capacity(64 * 1024);
    let mut limited = stream.take((MAX_BOOTSTRAP_BYTES + 1) as u64);
    limited
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read StarNet bootstrap page: {e}"))?;
    if bytes.len() > MAX_BOOTSTRAP_BYTES {
        return Err("StarNet bootstrap page exceeded the attach safety limit".to_string());
    }
    let response = String::from_utf8(bytes)
        .map_err(|_| "StarNet bootstrap response was not UTF-8".to_string())?;
    let status = response.lines().next().unwrap_or_default();
    if !status.contains(" 200 ") {
        return Err(format!("StarNet bootstrap request failed: {status}"));
    }
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .ok_or_else(|| "StarNet bootstrap response had no HTTP body".to_string())?;
    token_from_bootstrap_html(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(map: &[(&str, &str)]) -> HashMap<String, String> {
        map.iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn defaults_to_desktop_owned_spawn() {
        let vars = env(&[]);
        assert_eq!(parse_mode(|k| vars.get(k).cloned()).unwrap(), DesktopSidecarMode::Spawn);
    }

    #[test]
    fn attach_requires_an_explicit_valid_port() {
        let vars = env(&[(MODE_ENV, "attach"), ("STARNET_PORT", "8787")]);
        assert_eq!(
            parse_mode(|k| vars.get(k).cloned()).unwrap(),
            DesktopSidecarMode::Attach { port: 8787 }
        );
        for bad in ["", "0", "70000", "abc"] {
            let vars = env(&[(MODE_ENV, "external"), ("STARNET_PORT", bad)]);
            assert!(parse_mode(|k| vars.get(k).cloned()).is_err(), "bad port {bad:?}");
        }
    }

    #[test]
    fn attach_accepts_only_explicit_known_modes() {
        let vars = env(&[(MODE_ENV, "existing"), ("SKYNET_PORT", "9999")]);
        assert_eq!(
            parse_mode(|k| vars.get(k).cloned()).unwrap(),
            DesktopSidecarMode::Attach { port: 9999 }
        );
        let vars = env(&[(MODE_ENV, "magic")]);
        assert!(parse_mode(|k| vars.get(k).cloned()).is_err());
    }

    #[test]
    fn bootstrap_token_parser_handles_json_escaping_and_withheld_pages() {
        let token = token_from_bootstrap_html(
            r#"<script>window.__STARNET_API_TOKEN__="a\\\"b";window.x=1;</script>"#,
        )
        .unwrap();
        assert_eq!(token, "a\\\"b");

        let err = token_from_bootstrap_html(
            r#"<script>window.__STARNET_TOKEN_WITHHELD__="other-user";</script>"#,
        )
        .unwrap_err();
        assert!(err.contains("other-user"));
        assert!(token_from_bootstrap_html("<html>not starnet</html>").is_err());
    }

    #[test]
    fn ownership_is_explicit() {
        assert!(DesktopSidecarMode::Spawn.ownership().is_desktop());
        assert!(DesktopSidecarMode::Attach { port: 8787 }
            .ownership()
            .is_external());
    }
}
