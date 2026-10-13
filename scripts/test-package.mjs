import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the installed package directory.');
const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
const client = new Client({ name: 'release-package-test', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(directory, 'bin', 'decisions-browser.mjs')], cwd: directory, stderr: 'pipe' }));
  assert.equal(client.getServerVersion().version, manifest.version);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['browser_capabilities', 'run_browser_task']);
  const result = await client.callTool({ name: 'browser_capabilities', arguments: {} });
  assert.equal(result.structuredContent.name, 'decisions-browser');
  const invalid = await client.callTool({ name: 'run_browser_task', arguments: { goal: 'No URL or checks supplied.' } });
  assert.equal(invalid.isError, true);
  console.log(`Installed package ${manifest.version}: MCP handshake, tools, capabilities, and invalid-input rejection passed.`);
} finally { await client.close(); }
