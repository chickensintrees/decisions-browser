import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createMcpServer, publicTaskResult, SERVER_NAME, VERSION } from '../src/server.mjs';

const cli = fileURLToPath(new URL('../bin/decisions-browser.mjs', import.meta.url));
const serverModule = new URL('../src/server.mjs', import.meta.url).href;
const execFileAsync = promisify(execFile);
const task = {
  startUrl: 'http://127.0.0.1:9999/fixture.html',
  goal: 'Open the requested hotel.',
  checks: [{ type: 'visible', selector: '#detail' }]
};
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=';

async function memoryClient(t, runTask) {
  const server = createMcpServer({ runTask });
  const client = new Client({ name: 'offline-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('packaged CLI initializes, lists the production tools, and exposes capabilities', { timeout: 15000 }, async t => {
  const client = new Client({ name: 'packaged-cli-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, '--stdio'], stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual(client.getServerVersion(), { name: SERVER_NAME, version: VERSION });
  assert.ok(client.getServerCapabilities().tools);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['browser_capabilities', 'run_browser_task']);
  const run = tools.find(tool => tool.name === 'run_browser_task');
  assert.ok(run.inputSchema.required.includes('startUrl'));
  assert.ok(run.inputSchema.required.includes('checks'));
  assert.equal(run.inputSchema.additionalProperties, false);
  const result = await client.callTool({ name: 'browser_capabilities', arguments: {} });
  assert.equal(result.isError, undefined);
  assert.ok(result.structuredContent.operations.includes('fill'));
  assert.deepEqual(result.structuredContent.observations.jev, ['text']);
  assert.match(result.structuredContent.browser, /isolated/);
  assert.match(result.structuredContent.text, /finite/);
  const invalid = await client.callTool({ name: 'run_browser_task', arguments: { goal: 'Missing URL and checks.' } });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /validation|Invalid/i);
});

test('SDK input validation stops invalid arguments before the runner', async t => {
  let called = 0;
  const client = await memoryClient(t, async () => { called += 1; });
  const result = await client.callTool({ name: 'run_browser_task', arguments: { ...task, apiKey: 'never-a-tool-argument' } });
  assert.equal(result.isError, true);
  assert.equal(called, 0);
});

test('offline MCP task returns structured evidence, a separate image, and requested progress', async t => {
  const updates = [];
  const client = await memoryClient(t, async (input, { signal, onProgress }) => {
    assert.equal(input.provider, 'decisions');
    assert.equal(signal.aborted, false);
    await onProgress({ step: 1, total: input.maxSteps, action: 'Open hotel', url: input.startUrl });
    return {
      status: 'completed', verified: true, url: input.startUrl,
      checks: [{ passed: true }], trace: [], evidence: { screenshotPath: 'C:/evidence/task.png', screenshotBase64: tinyPng }
    };
  });
  const result = await client.callTool({ name: 'run_browser_task', arguments: task }, { onprogress: update => updates.push(update) });
  assert.equal(result.structuredContent.verified, true);
  assert.equal(result.structuredContent.evidence.screenshotPath, 'C:/evidence/task.png');
  assert.equal(result.structuredContent.evidence.screenshotBase64, undefined);
  assert.equal(JSON.stringify(result.structuredContent).includes(tinyPng), false);
  assert.equal(result.content[0].text.includes(tinyPng), false);
  assert.deepEqual(result.content[1], { type: 'image', data: tinyPng, mimeType: 'image/png' });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].progress, 1);
});

test('client cancellation reaches the runner and leaves the server usable', { timeout: 5000 }, async t => {
  let announceStarted;
  let announceStopped;
  const started = new Promise(resolve => { announceStarted = resolve; });
  const stopped = new Promise(resolve => { announceStopped = resolve; });
  let mutated = false;
  const client = await memoryClient(t, async (_input, { signal }) => {
    announceStarted();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { announceStopped(); reject(signal.reason); }, { once: true });
    });
    mutated = true;
  });
  const abort = new AbortController();
  const call = client.callTool({ name: 'run_browser_task', arguments: task }, { signal: abort.signal });
  await started;
  abort.abort('test cancellation');
  await assert.rejects(call);
  await stopped;
  assert.equal(mutated, false);
  const result = await client.callTool({ name: 'browser_capabilities', arguments: {} });
  assert.equal(result.structuredContent.name, SERVER_NAME);
});

test('stdio cancellation stops in-flight work and the connection still serves tools', { timeout: 10000 }, async t => {
  const bootstrap = `
    import { startStdioServer } from ${JSON.stringify(serverModule)};
    startStdioServer({ runTask: async (_input, { signal }) => {
      process.stderr.write('runner-started\\n');
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          process.stderr.write('runner-aborted\\n');
          reject(signal.reason);
        }, { once: true });
      });
      process.stderr.write('unexpected-mutation\\n');
    }});
  `;
  const client = new Client({ name: 'stdio-cancellation-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', bootstrap], stderr: 'pipe' });
  t.after(() => client.close());
  let stderr = '';
  let resolveStarted;
  let resolveAborted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  transport.stderr.on('data', chunk => {
    stderr += chunk;
    if (stderr.includes('runner-started')) resolveStarted();
    if (stderr.includes('runner-aborted')) resolveAborted();
  });
  await client.connect(transport);
  const abort = new AbortController();
  const call = client.callTool({ name: 'run_browser_task', arguments: task }, { signal: abort.signal });
  await started;
  abort.abort('stdio test cancellation');
  await assert.rejects(call);
  await aborted;
  const result = await client.callTool({ name: 'browser_capabilities', arguments: {} });
  assert.equal(result.structuredContent.name, SERVER_NAME);
  assert.equal(stderr.includes('unexpected-mutation'), false);
});

test('unverified results are MCP errors and CLI serialization excludes base64', async t => {
  const result = { status: 'needs_help', verified: false, evidence: { screenshotPath: 'C:/evidence/task.png', screenshotBase64: tinyPng } };
  const client = await memoryClient(t, async () => result);
  const reply = await client.callTool({ name: 'run_browser_task', arguments: task });
  assert.equal(reply.isError, true);
  assert.deepEqual(publicTaskResult(result), { status: 'needs_help', verified: false, evidence: { screenshotPath: 'C:/evidence/task.png' } });
  assert.equal(result.evidence.screenshotBase64, tinyPng);
});

test('CLI version/help are available and default stdio exits at EOF', { timeout: 15000 }, async () => {
  const { stdout: version } = await execFileAsync(process.execPath, [cli, '--version']);
  assert.equal(version.trim(), VERSION);
  const { stdout: help } = await execFileAsync(process.execPath, [cli, '--help']);
  assert.match(help, /run --task FILE/);
  assert.match(help, /OPENAI_API_KEY_FILE/);
  const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((resolve, reject) => { child.once('exit', code => resolve(code)); child.once('error', reject); });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stdin.end();
  assert.equal(await exit, 0);
  assert.equal(output, '');
});
