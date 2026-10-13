#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runBrowserTask } from '../src/controller.mjs';
import { normalizeTask } from '../src/task-schema.mjs';
import { VERSION, errorMessage, publicTaskResult, startStdioServer } from '../src/server.mjs';

const help = `decisions-browser ${VERSION}

Usage:
  decisions-browser [--stdio]            Serve MCP over stdin/stdout (default)
  decisions-browser run --task FILE      Run a task from a JSON file
  decisions-browser --version
  decisions-browser --help

Credentials: OPENAI_API_KEY or OPENAI_API_KEY_FILE; TYPESAFE_API_KEY for Jev.
Task results include screenshot file paths. MCP also returns screenshot image content.
`;

async function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--stdio')) {
    const handle = startStdioServer();
    const stop = () => { void handle.close().finally(() => { process.exitCode = 0; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(help); return; }
  if (args.length === 1 && args[0] === '--version') { process.stdout.write(`${VERSION}\n`); return; }
  if (args.length !== 3 || args[0] !== 'run' || args[1] !== '--task') {
    throw new Error('Invalid arguments. Use --help for usage.');
  }
  const source = await readFile(args[2], 'utf8');
  const task = normalizeTask(JSON.parse(source.replace(/^\uFEFF/, '')));
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Browser task cancelled.'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const result = await runBrowserTask(task, { signal: controller.signal });
    process.stdout.write(`${JSON.stringify(publicTaskResult(result), null, 2)}\n`);
    if (result.verified !== true) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

try { await main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ error: errorMessage(error) })}\n`);
  process.exitCode = 1;
}
