# Changelog

All notable changes to path-links are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-11

### Added

- Paths in assistant replies drawn as `file://` links, one per folder plus the file:
  a folder opens in the file manager, the file in its default app.
- Paths with spaces in running text, matched word by word against the file system.
- `~/…` and relative paths (resolved against the working directory), `:line[:col]` suffixes.
- Inline code holding a path becomes the links; inline code holding a command stays code.
- Fenced code blocks stay as written, with a `↳` line listing the paths they name.
- `/path-links [segments|file|off|blocks on|off|relative on|off]`, remembered across sessions.
- `userConfig`: `mode`, `codeBlocks`, `relative`.
