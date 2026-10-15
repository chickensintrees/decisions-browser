import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { launchBrowser } from '../runtime.mjs';
import { runBrowserTask } from '../src/controller.mjs';
import { startStdioServer, errorMessage } from '../src/server.mjs';
import { startFixtures } from '../test/fixtures/server.mjs';

export const VIEWPORT = Object.freeze({ width: 1120, height: 900 });

export async function beginCaptureWithFrameHandshake(page, { path, size = VIEWPORT, onFrame, timeoutMs = 5000 }) {
  let firstFrame;
  const firstFrameReady = new Promise(resolveFrame => { firstFrame = resolveFrame; });
  let timer;
  const timeout = new Promise((resolveTimeout, rejectTimeout) => {
    timer = setTimeout(() => rejectTimeout(new Error('Recording did not produce its first frame before the setup deadline.')), timeoutMs);
  });
  const started = Promise.resolve().then(() => page.screencast.start({ path, size, onFrame: frame => {
    onFrame?.(frame);
    firstFrame(frame);
  } }));
  const frameReady = Promise.race([Promise.all([started, firstFrameReady]), timeout]);
  const completedFrame = frameReady.then(([, frame]) => frame).catch(async error => {
    await page.screencast.stop().catch(() => {});
    throw error;
  }).finally(() => clearTimeout(timer));
  void completedFrame.catch(() => {});
  try {
    await Promise.race([started, timeout]);
    return { frameReady: completedFrame, cancel: () => clearTimeout(timer) };
  } catch (error) {
    await page.screencast.stop().catch(() => {});
    throw error;
  }
}

export async function startCaptureAfterFirstFrame(page, options) {
  const capture = await beginCaptureWithFrameHandshake(page, options);
  return capture.frameReady;
}

export function createCaptureLimits(onLimit, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let armed = false;
  let closed = false;
  let timer = schedule(() => onLimit('600-second-prearm-limit'), 600000);
  return {
    arm() {
      if (armed || closed) return;
      armed = true;
      cancel(timer);
      timer = schedule(() => onLimit('180-second-armed-capture-limit'), 180000);
    },
    close() { closed = true; cancel(timer); }
  };
}

export function createTimingState({ lane, checks, now = () => performance.now(), epochNow = () => Date.now() }) {
  let start;
  let verified;
  const metadata = {
    lane, verified: false, checks: [], expectedCheckCount: checks.length,
    recordingStartedAtEpochMs: null, startedAtEpochMs: null, verifiedAtEpochMs: null,
    verifiedDurationMs: null, videoStartOffsetMs: null, recordingTimeBasis: null,
    viewport: VIEWPORT, clockPrecisionMs: 100,
    protocol: 'Page-ready interaction time, ending at the first independent all-checks-pass observation. Setup, final agent confirmation, encoding and cleanup excluded. Real-time viewport recording; no audio. Native OS cursor, browser chrome and OS popup windows may not appear.'
  };
  const updateOffset = () => {
    if (metadata.startedAtEpochMs !== null && metadata.recordingStartedAtEpochMs !== null) metadata.videoStartOffsetMs = metadata.startedAtEpochMs - metadata.recordingStartedAtEpochMs;
  };
  return {
    metadata,
    frame(timestamp) {
      if (metadata.recordingStartedAtEpochMs !== null) return;
      const validEpoch = Number.isFinite(timestamp) && timestamp > 1e12;
      metadata.recordingStartedAtEpochMs = validEpoch ? timestamp : epochNow();
      metadata.recordingTimeBasis = validEpoch ? 'First shared Playwright screencast/video compositor frame timestamp, Unix milliseconds.' : 'First screencast frame receipt time; compositor timestamp unavailable.';
      updateOffset();
    },
    arm() {
      if (start !== undefined) return;
      start = now();
      metadata.startedAtEpochMs = epochNow();
      updateOffset();
    },
    observe(results) {
      metadata.checks = results;
      if (start === undefined || verified !== undefined || results.length !== checks.length || !results.length || !results.every(check => check.passed === true)) return false;
      verified = now();
      metadata.verified = true;
      metadata.verifiedAtEpochMs = epochNow();
      metadata.verifiedDurationMs = verified - start;
      return true;
    }
  };
}

export async function readPassiveChecks(page, checks) {
  return page.evaluate(declared => {
    const visible = element => !!element && !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    return declared.map(check => {
      try {
        if (check.type === 'url') return { ...check, actual: location.href, passed: check.match === 'equals' ? location.href === check.value : location.href.includes(check.value) };
        const matches = [...document.querySelectorAll(check.selector)];
        if (check.type === 'count') return { ...check, actual: matches.length, passed: matches.length === check.value };
        if (matches.length !== 1) return { ...check, actual: null, passed: false };
        const element = matches[0];
        if (check.type === 'visible') return { ...check, actual: visible(element), passed: visible(element) };
        if (check.type === 'text') return { ...check, actual: element.innerText, passed: visible(element) && element.innerText.includes(check.value) };
        if (check.type === 'value') return { ...check, actual: element.value, passed: element.value === check.value };
        if (check.type === 'checked') return { ...check, actual: element.checked, passed: element.checked === check.value };
        return { ...check, passed: false };
      } catch { return { ...check, passed: false, error: 'Unsupported or missing check target.' }; }
    });
  }, checks);
}

export async function createLaneRecorder({ lane, task, outputDir, monitorIntervalMs = 40 }) {
  await mkdir(outputDir, { recursive: true });
  const timing = createTimingState({ lane, checks: task.checks });
  const metadata = timing.metadata;
  const videoPath = join(outputDir, 'raw.webm');
  metadata.videoPath = videoPath;
  metadata.task = task;
  metadata.monitorIntervalMs = monitorIntervalMs;
  let page;
  let context;
  let browser;
  let interval;
  let observing = false;
  let finishPromise;
  let captureStopped = false;
  let armed = false;
  let capture;
  const save = () => writeFile(join(outputDir, 'result.json'), JSON.stringify(metadata, null, 2));
  const observeNow = async () => {
    if (!page || page.isClosed() || !armed || observing || metadata.verified) return;
    observing = true;
    try {
      const results = await readPassiveChecks(page, task.checks);
      if (timing.observe(results)) await save();
    } catch { /* Navigation can temporarily destroy the document being observed. */ }
    finally { observing = false; }
  };
  const stopCapture = async () => {
    if (captureStopped) return;
    captureStopped = true;
    clearInterval(interval);
    capture?.cancel();
    if (page && !page.isClosed()) await page.screencast.stop().catch(() => {});
  };
  const attach = async createdPage => {
    page = createdPage;
    capture = await beginCaptureWithFrameHandshake(page, { path: videoPath, size: VIEWPORT, onFrame: frame => timing.frame(frame.timestamp) });
    interval = setInterval(() => { void observeNow(); }, monitorIntervalMs);
    interval.unref();
  };
  const arm = () => { timing.arm(); armed = true; return { ...metadata }; };
  const prepareReadyPage = async createdPage => {
    await createdPage.locator('body').waitFor({ state: 'visible', timeout: 5000 });
    await createdPage.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
    const initialScreenshotPath = join(outputDir, 'initial.png');
    await createdPage.screenshot({ path: initialScreenshotPath, timeout: 5000 });
    await capture.frameReady;
    metadata.initialScreenshotPath = initialScreenshotPath;
    metadata.pageReadyAtEpochMs = Date.now();
  };
  const factory = async options => {
    metadata.actualBrowser = { headless: options?.headless ?? true };
    browser = await launchBrowser(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async settings => {
      context = await newContext({ ...settings, viewport: VIEWPORT });
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const createdPage = await newPage();
        await attach(createdPage);
        if (lane === 'decisions-browser') {
          const goto = createdPage.goto.bind(createdPage);
          createdPage.goto = async (...args) => { const response = await goto(...args); await prepareReadyPage(createdPage); arm(); return response; };
        }
        return createdPage;
      };
      const close = context.close.bind(context);
      context.close = async (...args) => { await observeNow(); await stopCapture(); return close(...args); };
      return context;
    };
    return browser;
  };
  return {
    metadata, factory, arm, observeNow,
    async setupBaseline() {
      const createdBrowser = await factory({ headless: false, timeout: 15000 });
      const createdContext = await createdBrowser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
      const createdPage = await createdContext.newPage();
      await createdPage.goto(task.startUrl, { waitUntil: 'domcontentloaded' });
      await prepareReadyPage(createdPage);
      metadata.browserPageTitle = await createdPage.title();
      metadata.readyAtEpochMs = Date.now();
      return { title: metadata.browserPageTitle, startUrl: task.startUrl };
    },
    finish(extra = {}) {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        await observeNow();
        await stopCapture();
        await context?.close().catch(() => {});
        await browser?.close().catch(() => {});
        Object.assign(metadata, extra, { finalizedAtEpochMs: Date.now() });
        await save();
        return metadata;
      })();
      return finishPromise;
    }
  };
}

export async function createSessionControl(recorder, { onStart } = {}) {
  let complete;
  let started = false;
  const finished = new Promise(resolveFinished => { complete = resolveFinished; });
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const send = (status, result) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    try {
      if (request.method === 'GET' && path === '/status') return send(200, recorder.metadata);
      if (request.method === 'POST' && path === '/start') {
        const result = recorder.arm();
        if (!started) { started = true; onStart?.(); }
        return send(200, result);
      }
      if (request.method === 'POST' && path === '/finish') {
        const result = await recorder.finish({ finishReason: 'operator-finished' });
        send(200, result);
        complete(result);
        return;
      }
      send(404, { error: 'Use GET /status, POST /start, or POST /finish.' });
    } catch (error) { send(500, { error: error.message }); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  return { url: `http://127.0.0.1:${server.address().port}`, finished, close: () => new Promise(resolveClose => server.close(resolveClose)), complete };
}

const self = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const argument = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };

async function taskForFixture(fixture) {
  const task = JSON.parse(await readFile(new URL('../examples/tasks/catalog.json', import.meta.url), 'utf8'));
  return { ...task, startUrl: fixture.origin + '/catalog', headless: false };
}

async function baselineMain(outputDir) {
  const fixture = await startFixtures();
  const task = await taskForFixture(fixture);
  const recorder = await createLaneRecorder({ lane: 'computer-use', task, outputDir });
  let control;
  let limits;
  try {
    const ready = await recorder.setupBaseline();
    control = await createSessionControl(recorder, { onStart: () => limits.arm() });
    limits = createCaptureLimits(async finishReason => { control.complete(await recorder.finish({ finishReason })); });
    const session = { lane: 'computer-use', fixtureOrigin: fixture.origin, startUrl: task.startUrl, controlURL: control.url, browserPageTitle: ready.title, outputDir, maximumCaptureMs: 180000, preArmIdleLimitMs: 600000, captureLimitStarts: 'POST /start', actualBrowser: { headless: false }, task };
    await writeFile(join(outputDir, 'session.json'), JSON.stringify(session, null, 2));
    console.log(JSON.stringify(session));
    const result = await control.finished;
    if (!result.verified) process.exitCode = 1;
  } finally {
    limits?.close();
    await recorder.finish();
    await control?.close();
    await fixture.close();
  }
}

async function mcpServerMain(outputDir) {
  startStdioServer({ runTask: async (task, options) => {
    const recorder = await createLaneRecorder({ lane: 'decisions-browser', task, outputDir });
    try {
      const result = await runBrowserTask(task, { ...options, browserFactory: recorder.factory, onProgress: async progress => { await recorder.observeNow(); await options.onProgress?.(progress); } });
      await recorder.finish({ controllerVerified: result.verified, controllerStatus: result.status, controllerError: result.error ? errorMessage(new Error(result.error)) : null, controllerTiming: result.timing, controllerTrace: result.trace });
      return result;
    } catch (error) { await recorder.finish({ error: errorMessage(error) }); throw error; }
  } });
}

async function decisionsMain(outputDir) {
  const fixture = await startFixtures();
  const task = await taskForFixture(fixture);
  const client = new Client({ name: 'decisions-browser-recorded-demo', version: '0.1.0' });
  const keyFile = argument('--key-file', process.env.OPENAI_API_KEY_FILE);
  const transport = new StdioClientTransport({ command: process.execPath, args: [self, '--mcp-server', '--output-dir', outputDir], cwd: root,
    env: { ...process.env, ...(keyFile ? { OPENAI_API_KEY_FILE: keyFile } : {}) }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (!tools.tools.some(tool => tool.name === 'run_browser_task')) throw new Error('Production MCP tool was not registered.');
    const start = performance.now();
    const response = await client.callTool({ name: 'run_browser_task', arguments: task }, { timeout: 130000 });
    const mcpWallMs = performance.now() - start;
    const result = response.structuredContent ?? JSON.parse(response.content.find(item => item.type === 'text').text);
    const metadataPath = join(outputDir, 'result.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    Object.assign(metadata, { mcpWallMs, actualMcpHandshake: true, actualMcpTool: 'run_browser_task', controllerVerified: result.verified, controllerStatus: result.status });
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(JSON.stringify({ outputDir, metadataPath, verified: metadata.verified, verifiedDurationMs: metadata.verifiedDurationMs, videoStartOffsetMs: metadata.videoStartOffsetMs, mcpWallMs, controllerStatus: result.status }));
    if (!metadata.verified || !result.verified) process.exitCode = 1;
  } finally { await client.close(); await fixture.close(); }
}

export async function main() {
  const mode = args.includes('--mcp-server') ? '--mcp-server' : args[0];
  if (!['baseline', 'decisions', '--mcp-server'].includes(mode)) throw new Error('Usage: node scripts/record-demo.mjs baseline|decisions --output-dir <directory> [--key-file <path>]');
  const outputDir = resolve(argument('--output-dir', join(root, 'artifacts', 'video-demo', mode === 'baseline' ? 'baseline' : 'decisions')));
  await mkdir(outputDir, { recursive: true });
  if (mode === 'baseline') await baselineMain(outputDir);
  else if (mode === 'decisions') await decisionsMain(outputDir);
  else await mcpServerMain(outputDir);
}

if (process.argv[1] && resolve(process.argv[1]) === self) main().catch(error => { console.error(error.message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')); process.exitCode = 1; });
