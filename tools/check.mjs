import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = new URL('..', import.meta.url);
let count = 0;
let failed = false;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'release', 'test-results', 'output', '.render'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (/\.(js|mjs|css|html|json)$/.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      const lines = text.trimEnd().split('\n').length;
      if (lines >= 250) { console.error(`${path}: ${lines} lines (must be < 250)`); failed = true; }
      if (/\.(js|mjs)$/.test(entry.name)) {
        const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
        if (result.status !== 0) { console.error(result.stderr); failed = true; }
      }
      if (entry.name.endsWith('.json')) JSON.parse(text);
      count++;
    }
  }
}
await inspect(fileURLToPath(base));
console.info(`${count} source files checked; ${failed ? 'FAILED' : 'OK'}`);
process.exitCode = failed ? 1 : 0;
