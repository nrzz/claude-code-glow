# Changelog

All notable changes to Claude Code Glow are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-04

- Fixed: the token doctor counted user-only skills (`disable-model-invocation: true`) as loaded in every session, so Glow's own three skills showed as about 38 tokens per session. User-only skills now have their own line at 0 tokens, and only the skills Claude may use on its own are counted.
- Fixed: the README and both plugin manifests said all 15 themes recolor the whole interface. `classic` themes the status line only: 15 themes for the status line, 14 of which also recolor the interface.
- README: what install and uninstall write (one `glow-<slug>.json` per interface theme plus the live `glow.json`, a `settings.json.bak-glow-<timestamp>` copy and a 2-space re-save, an empty `themes` folder that may remain), the skills' real cost (about 30 tokens by Claude Code's own estimate, for descriptions the model never sees), what the doctor reads and which findings come with a saving, when the HUD's Compact button shows, which HUD tests run on which surface, and Node 18 in CI.
- `glow` and `glow-hud` are versioned together, and a test keeps both manifests at the package version.

## [1.0.0] - 2026-10-03

- First release: a themed status line with zero-token tips in 15 themes, 14 of which recolor the whole Claude Code interface through a live theme file, an interactive picker, a static token doctor, a cheat sheet, and the glow-hud plugin.
- Fixed: the installer recognises its installed copy through symbolic links (macOS).

[1.0.1]: https://github.com/nrzz/claude-code-glow/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nrzz/claude-code-glow/releases/tag/v1.0.0
