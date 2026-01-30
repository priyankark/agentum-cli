# Agentum

Mirror terminal sessions and AI coding agents (Claude Code, GitHub Copilot, OpenAI Codex) to your mobile device over WebSocket.

Control your AI agents from anywhere - on your couch, in bed, or on the go.

## Features

- **Multi-Agent Support**: Mirror Claude Code, GitHub Copilot, OpenAI Codex, or any CLI tool
- **Real-time Streaming**: WebSocket-based live terminal output to mobile
- **VNC Screen Sharing**: Remote desktop control from your phone
- **Multiple Sessions**: Run and monitor multiple agent sessions simultaneously
- **Push Notifications**: Get notified when tasks complete
- **Cross-Platform**: Works on macOS, Linux, and Windows

## Installation

```bash
npm install -g agentum
```

## Quick Start

```bash
# Start the server
ag start

# Connect from mobile app at ws://<your-ip>:11042
```

## Commands

### `ag start`

Start the Agentum server (recommended).

```bash
ag start                    # Default ports (11042 for WebSocket, 11043 for VNC)
ag start --port 8080        # Custom WebSocket port
ag start --vnc-port 8081    # Custom VNC port
ag start --no-vnc           # Disable VNC server
```

### `ag run <command>`

Run a command and mirror to mobile.

```bash
ag run "npm test"           # Run and mirror output
ag run "npm test" -d        # Run detached (background)
ag run "npm test" -n build  # Custom session name
```

### `ag list`

List active sessions.

```bash
ag list                     # List all sessions
ag list --port 8080         # List sessions on custom port
```

### `ag attach <session-id>`

Attach to a running session locally.

```bash
ag attach abc123            # Attach to session
ag attach abc123 -p 8080    # Attach on custom port
```

Press `Ctrl+]` to detach from a session.

### `ag kill <session-id>`

Terminate a session.

```bash
ag kill abc123              # Kill session
```

### `ag screenshot`

Capture a screenshot to disk.

```bash
ag screenshot               # Saves to /tmp
ag screenshot -o ./shots    # Custom output directory
```

### `ag notify`

Send a notification to connected mobile clients.

```bash
ag notify --title "Build Complete" --body "All tests passed"
ag notify --title "Error" --body "Build failed" --priority high
ag notify --title "Done" --notification-type command_complete
```

Options:
- `--title, -t`: Notification title (default: "Agentum")
- `--body, -b`: Notification body
- `--priority, -P`: low | normal | high | urgent (default: normal)
- `--notification-type, -y`: info | warning | error | command_complete | session_ended

## Ports

| Service   | Default Port | Description                    |
|-----------|--------------|--------------------------------|
| WebSocket | 11042        | Main communication channel     |
| VNC       | 11043        | Screen sharing and remote control |

## Remote Access with Tailscale

For secure remote access from anywhere (not just your local network), use [Tailscale](https://tailscale.com/).

### Setup

1. **Install Tailscale** on your desktop/server:

   ```bash
   # macOS
   brew install tailscale

   # Linux (Debian/Ubuntu)
   curl -fsSL https://tailscale.com/install.sh | sh

   # Windows
   # Download from https://tailscale.com/download
   ```

2. **Start Tailscale and authenticate**:

   ```bash
   sudo tailscale up
   ```

3. **Get your Tailscale IP**:

   ```bash
   tailscale ip -4
   # Example output: 100.x.y.z
   ```

4. **Install Tailscale on your mobile device**:
   - [iOS App Store](https://apps.apple.com/app/tailscale/id1470499037)
   - [Google Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)

5. **Sign in with the same account** on your mobile device.

### Connect

1. Start Agentum on your desktop:

   ```bash
   ag start
   ```

2. Connect from your mobile app using your Tailscale IP:

   ```
   ws://100.x.y.z:11042
   ```

Your connection is now encrypted and works from anywhere in the world.

### Tips

- Tailscale IPs are stable - you can save the connection URL in the mobile app
- No port forwarding or firewall configuration required
- Works through NATs, firewalls, and across networks
- Enable [MagicDNS](https://tailscale.com/kb/1081/magicdns/) to use hostnames instead of IPs

## Mobile Apps

### iOS

**Status: W.I.P. (Work in Progress)**

App Store link coming soon.

### Android

**Status: W.I.P. (Work in Progress)**

Google Play link coming soon.

## AI Agent Integration

Agentum works seamlessly with popular AI coding agents:

### Claude Code

```bash
# Start Agentum server
ag start

# In another terminal, run Claude Code - output mirrors to mobile
claude
```

### GitHub Copilot CLI

```bash
ag start
gh copilot suggest "how to list files"
```

### OpenAI Codex

```bash
ag start
# Run your Codex-powered tool
```

The mobile app provides dedicated views for each agent type with optimized interfaces.

## Requirements

- Node.js >= 18.0.0
- macOS, Linux, or Windows

## Troubleshooting

### Port already in use

```bash
# Use a different port
ag start --port 8080

# Or find and kill the process using the port
lsof -i :11042
kill <PID>
```

### Cannot connect from mobile

1. Ensure both devices are on the same network (or use Tailscale)
2. Check your firewall allows connections on ports 11042 and 11043
3. Verify the server IP with `ifconfig` or `ip addr`

### VNC not working

```bash
# Try restarting with VNC explicitly enabled
ag start --vnc-port 11043

# Or disable if not needed
ag start --no-vnc
```

## License

MIT

## Repository

[https://github.com/priyankark/agentum-cli](https://github.com/priyankark/agentum-cli)
