---
name: setup
description: Install the Glow status line and themes.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs" *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs" install`

From the output above, reply in at most four lines: what was installed (or the error and its fix), then that picking "Glow (live)" once in /theme lets every later switch recolor the whole interface.
