# Remote access recipes (downstream)

StarNet's station listens on loopback only. Remote access is a forwarding concern,
and the v0.13.3 peer-owner check (`sidecar/peerowner.js`) is the security boundary
that decides whether a loopback client receives the bootstrap token: the process
owning the CLIENT end of the TCP connection must run as the same OS user as the
station. Anything unprovable withholds the token (fail closed). The downstream
never sets `STARNET_TRUST_LOCAL_PEERS=1`.

## SSH local forward (supported recipe)

```sh
# on the remote machine, as the SAME user that runs the station:
ssh -N -L 8787:127.0.0.1:8787 stationuser@stationhost
# then, locally:
starnet status --port 8787
# browser UI: http://127.0.0.1:8787/
```

Why this passes peer ownership, mechanically:

1. with `-L`, the connection to `127.0.0.1:8787` on the station host is opened by
   sshd's per-connection child, which runs as the authenticated login user after
   the privilege split (not as root);
2. `/proc/net/tcp{,6}` reports the owning UID of that client socket directly;
3. login user == station user -> same-UID -> the bootstrap page carries the master
   token; the CLI/browser/desktop attach all work through the tunnel unchanged.

Failure modes that stay closed (by design):

- a DIFFERENT user forwards in: the socket UID mismatches, the page loads but
  `window.__STARNET_TOKEN_WITHHELD__` is served instead of the token; attach and
  API calls fail with a clear error (`external_sidecar.rs` surfaces the reason);
- forwarding into a machine where the lookup cannot resolve (rare container
  setups): fail closed, same withheld page.

Tailscale SSH is equivalent in the relevant respect: the forwarding process runs
as the Tailscale-node user; use that user for the station if Tailscale forwards
are the access path. A tailnet-scoped `tailscale serve` (station-side reverse
proxy) is the alternative for read-only sharing: it terminates on the station
host itself and does not depend on peer ownership, but it must never expose the
bootstrap page beyond the tailnet ACL.

## What we deliberately do not do

- no `STARNET_TRUST_LOCAL_PEERS=1` default or module option;
- no weakening of the Host/Origin/token checks for remote browsing;
- no second station or relay process on the remote side; clients attach to the
  one canonical station.

The real-socket same-user round trip and the withheld-token paths are locked by
`test/peerowner.test.js` (49 assertions) and the bootstrap-token contract by the
Rust unit tests plus `test/external-attach.e2e.mjs`.
