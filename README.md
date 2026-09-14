# Agentum

> This release requires the updated Agentum mobile app and one-time pairing. Older anonymous apps cannot connect. See [connection setup](SECURITY_CHANGES.md).


Control AI coding agents from your phone. Mirror Claude Code, GitHub Copilot, OpenAI Codex and Cline to mobile.

## How It Works

```
┌──────────────┐     WebSocket      ┌──────────────┐
│  Your Phone  │ ◄────────────────► │   Desktop    │
│  (Agentum    │                    │(ag start)│
│   Mobile)    │                    │              │
└──────────────┘                    └──────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │ AI Agents   │
                                    │ Claude Code │
                                    │ Copilot     │
                                    │ Codex       │
                                    └─────────────┘
```

## Prerequisites

You need [Node.js](https://nodejs.org/) (v18+) installed. Then, install and authenticate the AI agents you want to control:

| Agent | Install | Login |
|-------|---------|-------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude` (follow prompts) |
| GitHub Copilot | `gh extension install github/gh-copilot` | `gh auth login` |
| OpenAI Codex | `npm install -g @openai/codex` | `codex` (follow prompts) |
| Cline | `npm install -g cline` | `cline auth` |

Only install and authenticate the agents you plan to use.

---

## Quick Setup

### 1. Install CLI on your desktop

```bash
npm install -g https://github.com/priyankark/agentum-cli/releases/download/v2.0.0/agentum-2.0.0.tgz
```

The GitHub release includes the built package. Agentum 2 requires AirCodum Agentum 1.1 or later. npm registry publication is pending publisher authentication; the unversioned npm package still installs the older server. Once version 2 is available on npm, `npm install -g agentum@2` is equivalent.

### 2. Start the server

```bash
ag start
```

The server shows your computer name, terminal/desktop ports, and available Wi-Fi or Tailscale addresses. The default terminal port is **11042**, and desktop sharing uses **11043**.

### 3. Pair your phone

In another terminal run:

```bash
ag pair
```

In the updated Agentum app, add a computer and scan the QR code. You can also enter the host, ports, and pairing key printed below it. QR generation stays on your computer. If you have several network adapters, choose the address your phone can reach:

```bash
ag pair --host 192.168.1.10
ag pair --host 100.89.59.102
```

Phones on the same Wi-Fi connect directly; Tailscale is optional for access from other networks. Public remote access requires a trusted TLS reverse proxy. See [setup details](SECURITY_CHANGES.md).

### Multiple computers and instances

Save each computer in the app and tap its card to switch. For separate Agentum instances on one computer, choose different port pairs:

```bash
ag start --port 11042 --name Work
ag start --port 12042 --name Personal
ag pair --port 12042
```

Desktop ports default to the terminal port plus one. Each terminal port has a persistent identity, so the app can detect an address that now points to a different instance. Terminal/agent sessions belong to their instance. **Desktop mode controls the same foreground desktop on that computer**; separate instances are not separate virtual desktops.

Desktop supports pinch zoom and pan in the updated app, wheel scrolling, right-click, explicit drag, and text/shortcut input. Native Screen Recording and Accessibility permissions are required on macOS.

### Cline sessions

After installing and authenticating Cline, restart `ag` from the same terminal so Cline is on its PATH. In the updated app, choose **Cline → New**, name the session, and optionally enter an absolute project folder on this computer. Leaving it empty uses the directory where `ag` started.

The preset launches the official interactive CLI with `cline --tui --auto-approve false`. Use the phone’s terminal key row for arrows, Enter, Tab, Esc and Ctrl+C; swipe horizontally to see additional keys. Tool approval prompts remain enabled. An unavailable installation produces setup guidance in the app.

Each new session starts a separate conversation. Running PTYs stay alive when a phone disconnects, and reattaching replays their terminal output. Stopping the server ends its PTYs; use Cline’s own history/resume commands from a manual terminal if you need an older conversation. Older Agentum servers can run `cline` manually in PTY mode, while the dedicated preset requires Agentum 2 and the updated app.

### Windows and WSL

Run Agentum in Windows PowerShell on the machine that owns the desktop. WSL/WSLg cannot capture the Windows host desktop; Agentum detects this and keeps terminal sessions available with explicit guidance. For WSL commands, create a terminal session running `wsl.exe` from the Windows-hosted server.

---

## Commands

### `ag start`

Start the server. Run this first.

```bash
ag start                    # Default: port 11042
ag start --port 8080        # Custom port
ag start --no-vnc           # Disable screen sharing
```

### `ag run <command>`

Run any command and mirror output to mobile.

```bash
ag run "npm test"
ag run "python train.py" -d     # Detached (background)
ag run "make build" -n build    # Named session
```

### `ag list`

Show active sessions.

### `ag attach <id>`

Attach to a session locally. Press `Ctrl+]` to detach.

### `ag kill <id>`

Stop a session.

### `agentum screenshot`

Capture screen to disk.

```bash
agentum screenshot                # Saves to /tmp
agentum screenshot -o ./shots     # Custom directory
```

### `agentum notify`

Push notification to phone.

```bash
agentum notify -t "Done" -b "Build complete"
agentum notify -t "Error" -b "Tests failed" -P high
```

---

## Remote Access (Tailscale) - Highly Recommended

Access from anywhere, not just your local network. Works through firewalls and NATs.

### Setup

1. Install [Tailscale](https://tailscale.com/download) on desktop and phone
2. Sign in with same account on both
3. Start Tailscale:
   ```bash
   tailscale up
   ```
4. Connect from mobile:
   - **IP/Host**: Your Tailscale IP (`tailscale ip -4`) or MagicDNS hostname (e.g., `your-desktop-name`)
   - **Port**: `11042`

---

## Ports

| Port  | Service   | Description              |
|-------|-----------|--------------------------|
| 11042 | WebSocket | Mobile ↔ Desktop         |
| 11043 | VNC       | Screen sharing (optional)|

---

---

## Troubleshooting

**Port in use?**
```bash
ag start --port 8080
```

**Can't connect from phone?**
- Same WiFi network?
- Firewall blocking port 11042?
- Try: `ping <desktop-ip>` from phone

**Find your IP:**
```bash
ifconfig | grep "inet "
```

---

## Links

- [Repository](https://github.com/priyankark/agentum-cli)
- [AirCodum](https://aircodum.com)
