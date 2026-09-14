# Connecting the updated Agentum app and server

This server requires the updated Agentum mobile app. Update the app before replacing an older anonymous server. The release candidate must remain opt-in until the matching mobile app is available.

1. Run `ag start`. The authenticated listeners bind to all interfaces for direct same-Wi-Fi use. Terminal port defaults to 11042, desktop port to 11043.
2. Run `ag pair` and scan the locally generated QR code in the app. Manual host, ports and pairing key are also printed. `ag pair --host <Wi-Fi-or-Tailscale-address>` selects another interface.
3. On the same trusted Wi-Fi, no Tailscale setup is required. For access from another network, use Tailscale on both devices, or a trusted TLS reverse proxy. Wi-Fi `ws` transport is unencrypted; use Tailscale/TLS when the network is not trusted. Do not expose these plain WebSocket ports directly to the Internet.
4. A TLS proxy should forward WebSocket upgrades and the Authorization header. Bind the server to loopback with `ag start --host 127.0.0.1`, configure the proxy’s terminal/desktop routes, and pair with `ag pair --host <proxy-hostname> --port <external-terminal-port> --vnc-port <external-desktop-port> --tls`. When internal and external terminal ports differ, add `--instance-port <internal-terminal-port>` so the QR identifies the running instance.

The pairing key is stored in `~/.agentum/pairing-token` with owner-only permissions. `AGENTUM_AUTH_TOKEN` can supply a 32–256 character key instead. Both listeners use it. Keep QR codes and keys private: they grant desktop and terminal control. To revoke a key, stop all Agentum servers, remove only the pairing-token file (or replace the environment key), restart, and pair again. Existing authorized connections are closed by stopping the server.

Persistent instance IDs and display names live beside the token. A distinct terminal port creates a distinct instance. Saved identity protects against accidentally controlling the wrong endpoint; it does not encrypt plain Wi-Fi transport. See [protocol details](COMPATIBILITY.md).

Agent execution uses normal CLI permission/sandbox behavior. A local operator can explicitly opt into previous unrestricted behavior with `AGENTUM_ALLOW_UNSANDBOXED=1`; remote clients cannot change that setting.

`npm test` builds and runs the bounded automated suite on Node 22+. Tests mock OS capture/input where indicated, so they do not prove native device behavior. Historical native evidence is in [NATIVE_VALIDATION.md](NATIVE_VALIDATION.md).
