# Agentum

Control AI coding agents from your phone. Mirror Claude Code, GitHub Copilot, and OpenAI Codex to mobile - code from your couch, bed, or anywhere.

## How It Works

```
┌──────────────┐     WebSocket      ┌──────────────┐
│  Your Phone  │ ◄────────────────► │   Desktop    │
│  (Agentum    │                    │(agentum start)│
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

Only install and authenticate the agents you plan to use.

---

## Quick Setup

### 1. Install CLI on your desktop

```bash
npm install -g agentum
```

### 2. Start the server

```bash
npx agentum start
```

This shows your connection info:
```
Terminal server started on port 11042
Connect from mobile using IP: <your-ip>, Port: 11042
```

### 3. Find your IP (if needed)

```bash
# macOS/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Or just use
hostname -I   # Linux
ipconfig      # Windows
```

### 4. Get the mobile app

| Platform | Status |
|----------|--------|
| iOS      | Coming soon |
| Android  | Coming soon |

### 5. Connect

Open the mobile app and enter:
- **IP/Host**: Your desktop's IP address
- **Port**: `11042` (default)

That's it! Your AI agents now stream to your phone.

---

## Commands

### `agentum start`

Start the server. Run this first.

```bash
agentum start                    # Default: port 11042
agentum start --port 8080        # Custom port
agentum start --no-vnc           # Disable screen sharing
```

### `agentum run <command>`

Run any command and mirror output to mobile.

```bash
agentum run "npm test"
agentum run "python train.py" -d     # Detached (background)
agentum run "make build" -n build    # Named session
```

### `agentum list`

Show active sessions.

### `agentum attach <id>`

Attach to a session locally. Press `Ctrl+]` to detach.

### `agentum kill <id>`

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
agentum start --port 8080
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
