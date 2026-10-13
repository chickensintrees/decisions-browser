import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findPublicLeaks } from './release-policy.mjs';
import { VERSION } from '../src/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'results', 'artifacts', 'release']);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:mjs|js|json|md|yml|yaml|toml|html|ps1)$/.test(entry.name)) files.push(path);
  }
  return files;
}
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (packageJson.version !== VERSION) throw new Error('Package and MCP server versions disagree.');
const files = await walk(root);
if (!files.length) throw new Error('Release detector found no source files.');
const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const finding of findPublicLeaks(source)) failures.push(`${relative(root, file)}: ${finding}`);
  if (file.endsWith('.ps1') && /[^\x00-\x7F]/.test(source)) failures.push(`${relative(root, file)}: Non-ASCII PowerShell source`);
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Release source checks passed (${files.length} files).`);
const tests = spawn(process.execPath, [join(root, 'scripts', 'test.mjs')], { cwd: root, stdio: 'inherit' });
tests.on('error', error => { console.error(error.message); process.exitCode = 1; });
tests.on('exit', code => { process.exitCode = code ?? 1; });
