---
name: doctor
description: Audit your setup for token waste.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs" *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/claude-glow.mjs" doctor --project "${CLAUDE_PROJECT_DIR}"`

The output above is a static audit of configuration files. In at most eight lines: the fixes that save the most tokens per session, each with its saving and the exact change, then one line on what is fine. Offer to make the changes; edit nothing until the user agrees.
