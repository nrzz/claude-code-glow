# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/claude-code-glow/security/advisories/new](https://github.com/nrzz/claude-code-glow/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/master/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool can and cannot protect

The status line runs as a command from your settings. The installer changes only the `statusLine` key of `settings.json`, after saving a copy of the file, and writes its own folder `claude-code-glow/` and its theme files in `themes/`; `uninstall` takes them out again. The HUD uses Claude Code's early-access function-hooks API.
