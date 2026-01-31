# Agentum

Control AI coding agents from your phone. Mirror Claude Code, GitHub Copilot, and OpenAI Codex to mobile - code from your couch, bed, or anywhere.

## How It Works

```
┌──────────────┐     WebSocket      ┌──────────────┐
│  Your Phone  │ ◄────────────────► │   Desktop    │
│  (Agentum    │                    │  (ag start)  │
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

## Quick Setup

### 1. Install CLI on your desktop

```bash
npm install -g agentum
```

### 2. Start the server

```bash
ag start
```

This shows your connection URL:
```
Terminal server started on port 11042
Connect from mobile: ws://<your-ip>:11042
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

Open the mobile app and enter: `ws://<your-ip>:11042`

That's it! Your AI agents now stream to your phone.

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

## Remote Access (Tailscale)

Access from anywhere, not just your local network.

### Setup

1. Install [Tailscale](https://tailscale.com/download) on desktop and phone
2. Sign in with same account on both
3. Get your Tailscale IP: `tailscale ip -4`
4. Connect from mobile: `ws://100.x.y.z:11042`

Works through firewalls, NATs, from anywhere in the world.

---

## Ports

| Port  | Service   | Description              |
|-------|-----------|--------------------------|
| 11042 | WebSocket | Mobile ↔ Desktop         |
| 11043 | VNC       | Screen sharing (optional)|

---

## Requirements

- Node.js 18+
- macOS, Linux, or Windows

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
