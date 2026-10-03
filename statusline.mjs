#!/usr/bin/env node
// Claude Code status line. Claude Code runs this command and pipes ONE JSON object to stdin;
// whatever it prints to stdout appears under the prompt.
//   settings.json:  "statusLine": { "type": "command", "command": "node \"/path/to/statusline.mjs\"", "padding": 0 }
// Reads <configDir>/claude-code-glow/config.json (theme, icons, segments, tips). Needs no network and
// runs no git command except a cached, time-limited `git status`. It never throws: on any problem it
// prints a minimal plain line instead.
//
// Environment (all optional):
//   CLAUDE_CONFIG_DIR   Claude Code's config folder (default ~/.claude)
//   GLOW_COLOR          0 = no color, 256 = xterm-256 colors; NO_COLOR also turns color off
//   COLUMNS             when set, the line is shortened to fit
import fs from "node:fs";
import { isatty } from "node:tty";

// Read stdin without touching process.stdin (that would switch a pipe to non-blocking mode).
function readStdin() {
  if (isatty(0)) return "";
  const chunks = [];
  const buf = Buffer.alloc(65536);
  const deadline = Date.now() + 3000;
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e && e.code === "EAGAIN" && Date.now() < deadline) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
      break; // EOF, closed stdin, anything else: use what we have
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
}

// What to print when rendering failed: the model name, or just "Claude".
function minimal(input) {
  const m = input && input.model;
  const name = typeof m === "string" ? m : m && (m.display_name || m.id);
  return String(name || "Claude").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, 80);
}

async function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || "{}"); } catch { input = {}; }
  try {
    const [{ loadConfig, loadTheme }, { render }] = await Promise.all([import("./src/config.mjs"), import("./src/render.mjs")]);
    const config = loadConfig();
    const theme = loadTheme(config.theme);
    const fromEnv = Number(process.env.COLUMNS);
    const columns = fromEnv > 0 ? fromEnv : process.stdout.columns || undefined;
    return render(input, config, theme, { columns });
  } catch {
    return minimal(input);
  }
}

process.stdout.on("error", () => {}); // a closed pipe is not worth a stack trace
process.stdout.write((await main()) + "\n");
