# Agentum connection and desktop protocol

Both WebSocket listeners require the same `Authorization: Bearer <key>` header. Native Android clients also set `Origin: aircodum://native`; absent Origin is accepted for Node clients. Other origins are rejected. No sessions, screen capture, or native input are exposed before authentication. The new app/server must be rolled out together: an old anonymous app cannot connect to this server, and authentication failure never falls back to anonymous access.

The first message on **both** terminal and desktop sockets is:

```json
{
  "type": "server_capabilities",
  "protocolVersion": 1,
  "instanceId": "persistent-id-for-terminal-port",
  "instanceName": "Work",
  "vncPort": 11043,
  "features": {
    "agents": ["claude", "copilot", "codex"],
    "pty": true,
    "vnc": true,
    "vncSharedPort": false,
    "vncPort": 11043,
    "vncStreamControl": true,
    "vncTextInput": true,
    "vncScroll": true,
    "vncRightClick": true,
    "vncMouseButtons": true,
    "vncInputReset": true
  }
}
```

The desktop port is advertised only if its listener started. Capability announcements describe protocol support, not installed/authenticated AI executables. Both listeners answer JSON `ping` with `pong`; transport pings detect dead sockets. Identity is saved per terminal port, retained across restarts and name changes. The default desktop port is terminal port + 1; `--vnc-port` overrides it. TLS proxies may require an explicit external desktop port in the app.

Desktop starts only after `vnc_start`. `vnc_stop`, disconnect, or `vnc_input_reset` releases that connection’s held mouse buttons without moving the cursor backward. Input sent after stopping is rejected. One phone cannot interrupt another phone’s held drag in the same server process. Multiple processes share the OS desktop; simultaneous gestures across separate processes are not isolated virtual desktops.

- `vnc_mouse_event`: existing `x`, `y`, `screenWidth`, `screenHeight`, `eventType: down|up|move`; optional `button: left|right|middle` defaults to left. Coordinates are finite and inside the supplied frame; the server scales/clamps to the physical desktop.
- `vnc_scroll`: the same frame coordinates, plus integer `deltaX`/`deltaY` from −120 to 120; at least one nonzero. Units match AirCodum (macOS ×12, Windows ×120, Linux ×1). `vnc_scroll_event` is an accepted alias.
- `vnc_keyboard_event` and `vnc_type` retain their existing schema. Text is limited to 4096 characters; shortcut modifier flags are released before later text.
- `vnc_input_reset`: releases held buttons while leaving the stream active.

`ag pair` generates JSON locally: `{type:"agentum-pairing",version:1,host,port,vncPort,tls,token,instanceId,instanceName}`. QR is additive to manual entry. Credentials are never placed in a hosted QR service or connection URL.

Run `npm test` on Node 22+ for authentication, real socket identity/port/reconnect/control tests, capture scheduling and native keyboard/encoding contracts. Native device validation of the previous hardening baseline is historical in `NATIVE_VALIDATION.md`; it is not evidence that this new release passed device testing.
