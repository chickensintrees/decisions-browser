import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { choose, keyFromFile, validateChoice } from './providers.mjs';
import { serveFixture, launchBrowser, snapshot, executeAction } from './runtime.mjs';
import { verifyResult } from './verifier.mjs';

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const smoke = args.includes('--smoke');
const mode = value('--mode', 'text');
if (!['text', 'image'].includes(mode)) throw new Error('--mode must be text or image.');
const repeats = Number(value('--runs', '5'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--runs must be an integer from 1 to 10.');
const providers = value('--providers', 'decisions,responses').split(',');
if (providers.some(p => !['decisions', 'responses', 'jev'].includes(p))) throw new Error('Unknown provider.');
const key = value('--key-file') ? await keyFromFile(value('--key-file')) : process.env.OPENAI_API_KEY;
const credentials = { decisions: key, responses: key, jev: process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY };
if (!smoke && providers.some(p => !credentials[p])) throw new Error('A requested provider has no credential configured.');
const goal = 'Choose city Lisbon, style Design, and enable Free cancellation. Search, then open the exact hotel Casa Flora. Finish only when its detail confirms Lisbon, Design, and Free cancellation.';
const label = value('--label', smoke ? 'smoke' : mode);
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('--label must contain only letters, numbers, underscores, or hyphens.');
const outputDir = new URL(`./results/${label}/`, import.meta.url);
await mkdir(outputDir, { recursive: true });
const fixture = await serveFixture();
let browser;
const runs = [];

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

async function run(provider, round) {
  const context = await browser.newContext({ viewport: { width: 1120, height: 1000 } });
  const page = await context.newPage();
  const trace = [];
  const started = performance.now();
  let verification = { passed: false, errors: ['No DONE decision.'] };
  let error = null;
  let finalState = null;
  try {
    await page.goto(fixture.url, { waitUntil: 'load', timeout: 5000 });
    for (let step = 0; step < 20; step++) {
      if (performance.now() - started > 90000) throw new Error('Per-run 90 second budget exceeded.');
      const observation = await snapshot(page);
      let decision;
      if (provider === 'scripted-smoke') {
        const descriptions = ['Set City to Lisbon', 'Set Style to Design', 'Set Free cancellation to checked', 'Click Search.', 'Click Open Casa Flora.'];
        const desired = descriptions[step];
        const action = desired ? observation.actions.find(a => a.description.startsWith(desired)) : observation.actions.find(a => a.id === 'DONE');
        if (!action) throw new Error(`Smoke action ${step + 1} unavailable.`);
        decision = { choice: action.id, latencyMs: 0, confidence: null, model: 'deterministic smoke only', usage: null };
      } else {
        const state = { goal, ...(mode === 'text' ? { visibleText: observation.text, controls: observation.controls } : { screenshotDataUrl: `data:image/png;base64,${(await page.screenshot({ fullPage: true })).toString('base64')}` }), recentActions: trace.slice(-6).map(t => t.action) };
        decision = await choose(provider, state, observation.actions, { key: credentials[provider] });
      }
      const action = validateChoice(decision.choice, observation.actions);
      trace.push({ step: step + 1, action: action.description, actionType: action.type, ...decision });
      if (action.type === 'done') {
        finalState = await page.evaluate(() => window.getBenchmarkState());
        verification = verifyResult(finalState);
        break;
      }
      const refreshed = await snapshot(page);
      if (JSON.stringify(refreshed) !== JSON.stringify(observation)) throw new Error('Page changed during decision; stale action refused.');
      await executeAction(page, action);
    }
  } catch (exception) { error = exception.message; }
  const elapsedMs = performance.now() - started;
  if (!finalState) finalState = await page.evaluate(() => window.getBenchmarkState()).catch(() => null);
  const screenshot = `${provider}-${round}.png`;
  await page.screenshot({ path: fileURLToPath(new URL(screenshot, outputDir)), fullPage: true }).catch(() => {});
  await context.close();
  const result = { provider, round, elapsedMs, passed: !error && verification.passed, error, verification, finalState, screenshot, trace };
  runs.push(result);
  console.log(JSON.stringify({ provider, round, passed: result.passed, elapsedMs: Math.round(elapsedMs), calls: trace.length, error, verificationErrors: verification.errors }));
  await writeFile(new URL('runs.partial.json', outputDir), JSON.stringify(runs, null, 2));
}

try {
  browser = await launchBrowser();
  if (smoke) await run('scripted-smoke', 1);
  else for (let round = 1; round <= repeats; round++) {
    const offset = (round - 1) % providers.length;
    const ordered = [...providers.slice(offset), ...providers.slice(0, offset)];
    for (const provider of ordered) await run(provider, round);
  }
  const summary = [...new Set(runs.map(r => r.provider))].map(provider => {
    const selected = runs.filter(r => r.provider === provider);
    const requests = selected.flatMap(r => r.trace);
    const successful = selected.filter(r => r.passed);
    return {
      provider, attempts: selected.length, passed: successful.length,
      medianTaskMsAllAttempts: median(selected.map(r => r.elapsedMs)), medianSuccessfulTaskMs: median(successful.map(r => r.elapsedMs)),
      medianModelMs: median(requests.map(t => t.latencyMs)), requests: requests.length,
      inputTokens: requests.reduce((sum, t) => sum + (t.usage?.input_tokens ?? 0), 0), outputTokens: requests.reduce((sum, t) => sum + (t.usage?.output_tokens ?? 0), 0),
      returnedModels: [...new Set(requests.map(t => t.model))]
    };
  });
  const report = {
    timestamp: new Date().toISOString(), mode: smoke ? 'deterministic browser smoke; no AI or speed comparison' : `live API ${mode} decision loops`,
    goal, fixtureSha256: createHash('sha256').update(await readFile(new URL('./fixture.html', import.meta.url))).digest('hex'),
    protocol: { repeats, freshContextEachAttempt: true, alternatingOrder: true, maximumSteps: 20, retries: 0, responsesReasoningEffort: 'none', viewport: [1120, 1000],
      observation: mode === 'image' ? 'Full-page screenshot at each step, plus DOM-derived available action descriptions. No body text or controls state provided separately.' : 'Rendered DOM text, current form values, and available action descriptions.',
      taskTimer: 'Includes local page navigation, DOM observation, per-step image capture when enabled, model requests, UI execution, 100ms search loading, and independent verification after DONE. Excludes shared browser startup, context creation, final evidence screenshot, and context cleanup.',
      scope: 'One synthetic local hotel task. Measures a custom browser controller, not ChatGPT built-in Computer Use. No external browsing, personal browser profile, payment, or booking.' },
    summary, runs
  };
  await writeFile(new URL('report.json', outputDir), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary, report: new URL('report.json', outputDir).pathname }, null, 2));
  if (runs.some(r => !r.passed)) process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture.close();
}
