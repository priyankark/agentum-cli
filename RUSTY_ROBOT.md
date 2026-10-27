# Rusty Robot input backend (experimental)

Agentum can use [Rusty Robot](https://github.com/priyankark/rusty-robot) for its VNC
mouse and keyboard input. RobotJS remains the default. Capture/encoding continues
through the existing pipeline; this change makes no end-to-end speedup claim.

Build from a source checkout with Node 22+ and Rust 1.88+ plus the native compiler
for your OS (Xcode command line tools on macOS; MSVC Build Tools on Windows):

```sh
npm ci
npm run build
npm run build:rusty-robot
AGENTUM_INPUT_BACKEND=rusty-robot node dist/index.js
```

PowerShell: `$env:AGENTUM_INPUT_BACKEND = 'rusty-robot'` before starting Agentum.
The build downloads the pinned Rust source/dependencies and produces
`native/rusty-robot/agentum-rusty-robot.node` for the current host. It is a Node-API
addon, not a standalone executable. No prebuilt binaries or automatic installation
are provided. Use a source checkout for this preview.

`AGENTUM_RUSTY_ROBOT_PATH` optionally selects an **absolute path** to a trusted addon
built from this source. Selecting Rust and failing to load it reports an error;
it does not silently switch to RobotJS. Unset `AGENTUM_INPUT_BACKEND` to roll back.
The existing authenticated VNC protocol and session ownership still apply.

macOS requires Accessibility for the Agentum host. Screen Recording is still
needed by the existing capture pipeline. Linux requires an X11/XTest session;
Windows requires an interactive desktop. A sleeping/disconnected display can
make screen-size queries fail; resume the session before testing.

The adapter preserves normalized keys and native scroll units. Held movement uses
Rust's explicit drag API. Release events update adapter state only after successful
native delivery. Synchronous text input blocks Node while characters are sent;
macOS retains Rusty Robot's 10 ms minimum interval per Unicode scalar. This initial
adapter intentionally preserves synchronous ordering. Worker-based input and
packaged cross-platform binaries are follow-up work.

## Verify

```sh
npm test
AGENTUM_INPUT_BACKEND=rusty-robot node --test tests/vnc-controls.test.cjs
npm run test:rusty-robot:native
```

The first two commands verify adapter contracts and authenticated socket control
with fake native outputs. The third uses the built addon for real queries and
invalid-input checks without moving or typing. On Linux it needs an X11 session
(or `xvfb-run -a npm run test:rusty-robot:native`).

For real macOS input into an owned AppKit window:

```sh
node tests/rusty-robot-native.cjs --gui
```

This exercises Agentum's authenticated WebSocket → input handler → Rust addon →
AppKit. It asserts a button click, Unicode/multiline text, shortcut cleanup, Enter
alias, and drag selection/cancellation. The test uses a stub for continuous screen
streaming only; all input is native. Keep the desktop idle during the run. The
fixture closes and pointer position is restored on completion. Optional
`AGENTUM_RUSTY_EVIDENCE=/absolute/path/prefix` saves an owned-window PNG and JSON.
No credentials or unrelated desktop captures are saved.

The AppKit fixture derives from Rusty Robot, copyright (c) 2026 Priyankar Kumar and
contributors, MIT; see this repository's LICENSE for the same permission terms.
The integration was built by dogfooding Rusty Robot's bundled agent skill; detailed
results are recorded in `NATIVE_VALIDATION.md`.
