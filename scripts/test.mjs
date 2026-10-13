import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const tests = (await readdir(new URL('../test/', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`);
if (!tests.length) throw new Error('No tests discovered.');
const processUnderTest = spawn(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: root, stdio: 'inherit' });
processUnderTest.on('error', error => { console.error(error.message); process.exitCode = 1; });
processUnderTest.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
