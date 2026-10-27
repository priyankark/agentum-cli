# Changelog

## 2.1.0 — 2026-10-27

- Add opt-in Rust desktop input, capture, resize, fingerprinting, and JPEG/PNG encoding through the shared Rusty Robot bridge.
- Bound native media jobs, suppress unchanged frames, and discard stale captures after stop or settings changes.
- Preserve Unicode scalar boundaries and native multiline input on macOS.
- Include source-build tooling in the CLI package; exclude local session data, benchmarks, and host-specific binaries.
- Verified macOS streaming: 23.9 FPS versus 9.5 FPS with the original backend at 1440×810 JPEG quality 85; see the [benchmark report](https://priyankark.github.io/rusty-robot/).

Rust remains opt-in and requires Git and Rust 1.88+ to build for the host. The original backend remains the default. See [setup](RUSTY_ROBOT.md).
