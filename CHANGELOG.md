# Changelog

## 2.2.0 — 2026-10-27

- Keep capture configuration usable while the display is unavailable, recover captures after it returns, and make failed stream starts retryable without leaked subscriptions.

- Fix missing Codex chat answers by supporting current and legacy CLI JSONL, preserving history and reporting empty/failed turns correctly.
- Reject fractional and non-numeric capture settings before scheduling native work.

- Make Rust the default input, capture, screenshot, and image-processing backend.
- Ship tested native binaries and bundled terminal prebuilds for supported 64-bit macOS, Windows, and Linux targets.
- Keep RobotJS and JavaScript media as an explicit opt-in, with no silent fallback.
- Allow initial setup before Accessibility is granted and check permission at input time.
- Verify fresh installs with lifecycle scripts disabled, real PTY output, native image processing, and both backend selections.

## 2.1.0 — 2026-10-27

- Add opt-in Rust desktop input, capture, resize, fingerprinting, and JPEG/PNG encoding through the shared Rusty Robot bridge.
- Bound native media jobs, suppress unchanged frames, and discard stale captures after stop or settings changes.
- Preserve Unicode scalar boundaries and native multiline input on macOS.
- Include source-build tooling in the CLI package; exclude local session data, benchmarks, and host-specific binaries.
- Verified macOS streaming: 23.9 FPS versus 9.5 FPS with the original backend at 1440×810 JPEG quality 85; see the [benchmark report](https://priyankark.github.io/rusty-robot/).

Rust remains opt-in and requires Git and Rust 1.88+ to build for the host. The original backend remains the default. See [setup](RUSTY_ROBOT.md).
