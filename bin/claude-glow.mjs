#!/usr/bin/env node
// claude-glow: color themes, a glow status line and zero-token tips for Claude Code.
// All the work lives in src/cli.mjs; run `claude-glow --help` for the commands.
import { main } from "../src/cli.mjs";

process.exitCode = await main(process.argv.slice(2));
