---
name: theme
description: Switch the Glow theme.
disable-model-invocation: true
argument-hint: [theme name]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs" *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs" theme set "$ARGUMENTS"`

Reply in one line: the theme now active, or, if none matched, the theme names above and a request to pick one.
