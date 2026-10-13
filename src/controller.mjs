import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { choose, keyFromFile, validateChoice } from '../providers.mjs';
import { launchBrowser } from '../runtime.mjs';
import { normalizeTask } from './task-schema.mjs';
import { observePage, sameAction, performAction, evaluateChecks } from './browser.mjs';

async function abortable(operation, signal, disposeLate = async () => {}) {
  signal.throwIfAborted();
  return new Promise((resolveOperation, rejectOperation) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; rejectOperation(signal.reason); } };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(value => {
      signal.removeEventListener('abort', abort);
      if (settled || signal.aborted) { void Promise.resolve(disposeLate(value)).catch(() => {}); abort(); return; }
      settled = true;
      resolveOperation(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      if (!settled) { settled = true; rejectOperation(error); }
    });
  });
}

export async function loadProviderCredential(provider) {
  if (provider === 'jev') {
    const key = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY;
    if (!key) throw new Error('Set TYPESAFE_API_KEY for Jev.');
    return key;
  }
  const key = process.env.OPENAI_API_KEY ?? (process.env.OPENAI_API_KEY_FILE ? await keyFromFile(process.env.OPENAI_API_KEY_FILE) : undefined);
  if (!key) throw new Error('Set OPENAI_API_KEY or OPENAI_API_KEY_FILE.');
  return key;
}

export async function runBrowserTask(input, { signal: callerSignal, onProgress, chooseAction = choose, credentialLoader = loadProviderCredential, browserFactory = launchBrowser } = {}) {
  const task = normalizeTask(input);
  const started = performance.now();
  const deadline = AbortSignal.timeout(task.timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  const trace = [];
  const blockedRequests = [];
  let browser;
  let context;
  let page;
  let checks = [];
  let status = 'step_limit';
  let error = null;
  let extractedText = '';
  let title = '';
  let evidence = {};
  let modelRequests = 0;
  let modelMs = 0;
  const artifactDir = resolve(process.env.DECISIONS_BROWSER_ARTIFACT_DIR ?? join(tmpdir(), 'decisions-browser'), randomUUID());
  const isAllowed = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && task.allowedOrigins.includes(url.origin) && !url.username && !url.password; } catch { return false; }
  };
  const abortBrowser = () => { void context?.close().catch(() => {}); };
  try {
    signal.throwIfAborted();
    const key = await abortable(() => credentialLoader(task.provider), signal);
    signal.throwIfAborted();
    browser = await abortable(() => browserFactory({ headless: task.headless, timeout: task.timeoutMs }), signal, value => value.close());
    context = await abortable(() => browser.newContext({ viewport: { width: 1120, height: 900 }, serviceWorkers: 'block', acceptDownloads: false }), signal, value => value.close());
    signal.addEventListener('abort', abortBrowser, { once: true });
    signal.throwIfAborted();
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (!isAllowed(url)) { if (blockedRequests.length < 30) blockedRequests.push({ url: url.slice(0, 2000), resourceType: route.request().resourceType() }); await route.abort('blockedbyclient'); return; }
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: Math.min(15000, task.timeoutMs) });
        if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
          if (blockedRequests.length < 30) blockedRequests.push({ url: new URL(response.headers().location, url).href.slice(0, 2000), resourceType: 'http-redirect' });
          await route.abort('blockedbyclient');
          return;
        }
        await route.fulfill({ response });
      } catch { await route.abort('failed').catch(() => {}); }
    });
    await context.routeWebSocket('**/*', socket => {
      if (blockedRequests.length < 30) blockedRequests.push({ url: socket.url().slice(0, 2000), resourceType: 'websocket' });
      socket.close({ code: 1008, reason: 'WebSockets are unsupported by this bounded controller.' });
    });
    context.on('page', popup => {
      if (page && popup !== page) { blockedRequests.push({ url: 'popup', resourceType: 'new-page' }); void popup.close(); }
    });
    page = await abortable(() => context.newPage(), signal, value => value.close());
    page.on('dialog', dialog => { void dialog.dismiss(); });
    page.on('download', download => { void download.cancel(); });
    await page.goto(task.startUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(15000, task.timeoutMs) });
    for (let step = 1; step <= task.maxSteps; step++) {
      signal.throwIfAborted();
      if (!isAllowed(page.url())) throw new Error('Browser left the permitted origins.');
      const observation = await observePage(page, task.textValues);
      title = observation.title;
      const actions = observation.actions.filter(action => !action.href || isAllowed(action.href));
      const recentActions = trace.slice(-6).map(item => item.action);
      const state = { goal: task.goal, completionCriteria: task.checks, url: observation.url, title: observation.title, recentActions, ...(task.observation === 'image' ? { screenshotDataUrl: `data:image/png;base64,${(await page.screenshot()).toString('base64')}` } : { visibleText: observation.text, controls: observation.controls }) };
      const remaining = task.timeoutMs - (performance.now() - started);
      const decisionStarted = performance.now();
      let decision;
      modelRequests += 1;
      try {
        decision = await chooseAction(task.provider, state, actions, { key, signal, timeoutMs: Math.max(1, Math.min(20000, Math.floor(remaining))) });
      } catch (exception) {
        trace.push({ step, total: task.maxSteps, action: 'Decision rejected before input.', actionType: 'rejected', latencyMs: performance.now() - decisionStarted, model: exception.model ?? null, usage: exception.usage ?? null, error: exception.message });
        throw exception;
      } finally { modelMs += performance.now() - decisionStarted; }
      signal.throwIfAborted();
      const action = validateChoice(decision.choice, actions);
      const event = { step, total: task.maxSteps, action: action.description, url: page.url() };
      await onProgress?.(event);
      signal.throwIfAborted();
      trace.push({ ...event, actionType: action.type, latencyMs: decision.latencyMs ?? 0, model: decision.model ?? null, confidence: decision.confidence ?? null, usage: decision.usage ?? null });
      if (action.type === 'done') { checks = await evaluateChecks(page, task.checks); status = checks.every(check => check.passed) ? 'completed' : 'verification_failed'; break; }
      if (action.type === 'help') { status = 'needs_help'; break; }
      const refreshed = await observePage(page, task.textValues);
      if (!sameAction(action, refreshed.actions.find(candidate => candidate.id === action.id))) { trace.at(-1).skipped = 'stale action'; continue; }
      signal.throwIfAborted();
      await performAction(page, action, signal);
    }
    signal.throwIfAborted();
    if (!checks.length) checks = await evaluateChecks(page, task.checks);
    extractedText = (await page.locator('body').innerText()).slice(0, 16000);
    await mkdir(artifactDir, { recursive: true });
    const screenshotPath = join(artifactDir, 'final.png');
    const screenshot = await page.screenshot({ path: screenshotPath });
    evidence = { screenshotPath, screenshotBase64: screenshot.toString('base64') };
  } catch (exception) {
    status = signal.aborted ? (callerSignal?.aborted ? 'cancelled' : 'timed_out') : 'error';
    error = signal.aborted ? (status === 'cancelled' ? 'Task cancelled.' : 'Task deadline exceeded.') : exception.message;
  } finally {
    signal.removeEventListener('abort', abortBrowser);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  const result = {
    status, verified: status === 'completed' && checks.length > 0 && checks.every(check => check.passed),
    url: page?.url() ?? task.startUrl, title, checks, extractedText, trace, blockedRequests, error, evidence,
    timing: { totalMs: performance.now() - started, modelMs, modelRequests },
    limitations: 'Fresh isolated browser. DOM-derived actions, including in image mode. No personal browser profile or native desktop control.'
  };
  if (evidence.screenshotPath) {
    await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ ...result, evidence: { screenshotPath: evidence.screenshotPath } }, null, 2));
    result.evidence.resultPath = join(artifactDir, 'result.json');
  }
  return result;
}
