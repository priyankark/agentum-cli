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

Use **AirCodum Agentum 1.1 or later** on your phone. Connect your phone and computer to the **same Wi-Fi** for initial setup.

### 1. Start Agentum on your computer

Open a terminal on your computer and run:

```bash
npx agentum@2 start
```

If npm asks to install Agentum, enter `y`. No global installation is required. Run this from your project folder if you want new sessions to use that folder by default.

**Leave this terminal running.** It shows your computer name, network addresses, and ports: **11042** for terminal sessions and **11043** for desktop sharing. The QR code appears in the next step.

### 2. Display the QR code in a second terminal

Open a **second terminal tab or window** on your computer (**⌘T** in macOS Terminal), then run:

```bash
npx agentum@2 pair
```

**A QR code appears directly in this second terminal.** Your computer's host address, terminal port, desktop port, and pairing key are printed underneath it.

### 3. Pair your phone

On your phone, open **Agentum → Add computer → Scan QR code**. Point your phone's camera at the QR code displayed in your computer's second terminal.

If scanning fails, enter the **host, terminal port, desktop port, and pairing key** printed below the QR code into the app manually. Keep the first terminal (`start`) running while you use Agentum.

If you have several network adapters, choose the address your phone can reach (replace the example with your computer's Wi-Fi or Tailscale address):

```bash
npx agentum@2 pair --host 192.168.1.10
```

Phones on the same Wi-Fi connect directly; Tailscale is optional for access from other networks. Public remote access requires a trusted TLS reverse proxy. See [setup details](SECURITY_CHANGES.md).

### Optional: install globally to use `ag`

If you prefer the shorter `ag` command:

```bash
npm install -g agentum@2
```

Installation alone **does not start the server or display a QR code**. Run `ag start` in one terminal, leave it running, then run `ag pair` in a second terminal to display the QR code. Scan it in the phone app as described above.

The examples below use `ag`. Without a global install, replace `ag` with `npx agentum@2` (for example, `npx agentum@2 list`).

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

### `ag pair`

Display the QR code and manual connection details directly in your terminal. Keep the server running in another terminal while you pair your phone.

```bash
ag pair
ag pair --host 192.168.1.10    # Choose this computer's reachable address
ag pair --port 12042          # Match a server started with --port 12042
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

### `ag screenshot`

Capture screen to disk.

```bash
ag screenshot                # Saves to /tmp
ag screenshot -o ./shots     # Custom directory
```

### `ag notify`

Push notification to phone.

```bash
ag notify -t "Done" -b "Build complete"
ag notify -t "Error" -b "Tests failed" -P high
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

**Where is the QR code?**
Run `npx agentum@2 pair` (or `ag pair` after a global install) in a second terminal. The QR code is printed in that terminal, above the host, ports, and pairing key. Installing the package or running `start` does not display it.

**QR code looks distorted or won't scan?**
Widen the terminal and reduce its font size until the entire QR code fits without wrapping, then run `pair` again. Use a monospaced terminal font with normal line spacing so the code looks square. Scan using **Agentum → Add computer → Scan QR code**. If scanning still fails, enter the host, ports, and pairing key printed underneath the code manually in the app.

**`pair` is an unknown command?**
Check `ag --version`. Pairing requires Agentum 2 or later. Run `npm install -g agentum@2` to update, or use `npx agentum@2 pair` directly.

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
