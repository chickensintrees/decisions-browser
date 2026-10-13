import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startFixtures } from '../test/fixtures/server.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const rounds = Number(arg('--runs', '5'));
const modes = arg('--modes', 'text').split(',');
const taskNames = arg('--tasks', 'catalog,queue').split(',');
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10 || modes.some(mode => !['text', 'image'].includes(mode)) || taskNames.some(name => !['catalog', 'queue'].includes(name))) throw new Error('Invalid benchmark options.');
const root = fileURLToPath(new URL('../', import.meta.url));
const keyFile = arg('--key-file', process.env.OPENAI_API_KEY_FILE);
if (!keyFile && !process.env.OPENAI_API_KEY) throw new Error('Provide --key-file or OPENAI_API_KEY.');
const output = join(root, 'benchmarks', arg('--label', 'v0.1.0'));
await mkdir(output, { recursive: true });
const fixture = await startFixtures();
const client = new Client({ name: 'decisions-browser-release-benchmark', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'bin', 'decisions-browser.mjs')], cwd: root,
  env: { ...process.env, ...(keyFile ? { OPENAI_API_KEY_FILE: keyFile } : {}), DECISIONS_BROWSER_ARTIFACT_DIR: join(root, 'artifacts', 'release-benchmark') }, stderr: 'pipe' });
const sourceHashes = {};
for (const name of ['src/browser.mjs', 'src/controller.mjs', 'src/task-schema.mjs', 'src/server.mjs', 'bin/decisions-browser.mjs', 'providers.mjs', 'runtime.mjs', 'test/fixtures/server.mjs', 'examples/tasks/catalog.json', 'examples/tasks/queue.json', 'scripts/live-mcp-benchmark.mjs', 'package-lock.json']) sourceHashes[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
const runs = [];
const median = list => { const values = [...list].sort((a, b) => a - b); return values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2; };
try {
  await client.connect(transport);
  for (const observation of modes) for (const name of taskNames) for (let round = 1; round <= rounds; round++) {
    const providers = round % 2 ? ['decisions', 'responses'] : ['responses', 'decisions'];
    for (const provider of providers) {
      const input = JSON.parse(await readFile(join(root, 'examples', 'tasks', `${name}.json`), 'utf8'));
      const task = { ...input, startUrl: fixture.origin + new URL(input.startUrl).pathname, provider, observation };
      const start = performance.now();
      let result;
      let error = null;
      try {
        const response = await client.callTool({ name: 'run_browser_task', arguments: task }, { timeout: 130000 });
        result = response.structuredContent ?? JSON.parse(response.content.find(item => item.type === 'text').text);
      } catch (exception) { error = exception.message; result = { status: 'error', verified: false }; }
      const wallMs = performance.now() - start;
      const screenshot = `${name}-${observation}-${provider}-${round}.png`;
      if (result.evidence?.screenshotPath) await copyFile(result.evidence.screenshotPath, join(output, screenshot));
      const sanitized = { ...result, evidence: result.evidence?.screenshotPath ? { screenshotPath: screenshot } : {}, error: error ?? result.error };
      runs.push({ task: name, observation, provider, round, wallMs, result: sanitized });
      console.log(JSON.stringify({ task: name, observation, provider, round, verified: result.verified, status: result.status, wallMs: Math.round(wallMs), calls: result.timing?.modelRequests, error: sanitized.error }));
      await writeFile(join(output, 'runs.json'), JSON.stringify(runs, null, 2));
    }
  }
  const summary = [];
  for (const observation of modes) for (const task of taskNames) for (const provider of ['decisions', 'responses']) {
    const selected = runs.filter(run => run.task === task && run.provider === provider && run.observation === observation);
    const successful = selected.filter(run => run.result.verified);
    const traces = selected.flatMap(run => run.result.trace ?? []);
    summary.push({ task, observation, provider, attempts: selected.length, verified: successful.length, medianMcpWallMsAllAttempts: median(selected.map(run => run.wallMs)), medianVerifiedMcpWallMs: successful.length ? median(successful.map(run => run.wallMs)) : null,
      medianModelMs: traces.length ? median(traces.map(item => item.latencyMs)) : null, modelRequests: traces.length,
      inputTokens: traces.reduce((sum, item) => sum + (item.usage?.input_tokens ?? 0), 0), outputTokens: traces.reduce((sum, item) => sum + (item.usage?.output_tokens ?? 0), 0), returnedModels: [...new Set(traces.map(item => item.model))] });
  }
  const report = { timestamp: new Date().toISOString(), version: '0.1.0', protocol: { rounds, tasks: taskNames, modes, alternatingOrder: true, retries: 0,
    timer: 'MCP client call start through returned verified task result: includes browser startup, page loads, decisions, execution, checks, evidence capture, cleanup, and JSON-RPC transport.',
    observation: 'Text uses rendered DOM and form state. Image supplies viewport screenshot plus DOM-derived action descriptions.',
    independentVerification: 'The controller evaluates declared DOM/URL assertions after DONE. Fixture server request logs additionally show actual searches and navigation.',
    baseline: 'Same gpt-6-luna, Responses strict JSON with reasoning effort none. One bounded MCP tool call owns each action loop. No ChatGPT built-in Computer Use timing.' }, sourceHashes, summary, runs, fixtureRequests: fixture.requests };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary, report: join('benchmarks', arg('--label', 'v0.1.0'), 'report.json') }, null, 2));
  if (runs.some(run => !run.result.verified)) process.exitCode = 1;
} finally { await client.close(); await fixture.close(); }
