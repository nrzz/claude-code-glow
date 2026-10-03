// Entry point so that `node --test test/` (the `npm test` command) works on every Node version.
// Node 20 and older search a directory argument for test files themselves. From Node 21 on, a
// directory argument is no longer searched: it is resolved like `node test/`, which runs this file.
// So here, on those newer versions, load every *.test.mjs next to this file. On older versions this
// does nothing, because the runner has already found and started the files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (Number(process.versions.node.split(".")[0]) >= 21) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
  for (const file of files) await import(pathToFileURL(path.join(dir, file)).href);
}
