import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { taskSchema } from './task-schema.mjs';
import { runBrowserTask } from './controller.mjs';

export const SERVER_NAME = 'decisions-browser';
export const VERSION = '0.1.0';

export const capabilities = Object.freeze({
  name: SERVER_NAME,
  version: VERSION,
  operations: ['click', 'fill', 'select', 'check', 'radio', 'enter', 'scroll', 'wait', 'done', 'help'],
  browser: 'Fresh isolated browser context for each task; no existing personal browser profile.',
  text: 'Only supplied textValues are offered as finite choices. The decision model cannot invent text.',
  providers: ['decisions', 'responses', 'jev'],
  observations: { decisions: ['text', 'image'], responses: ['text', 'image'], jev: ['text'] },
  verification: 'Completion requires the supplied independent DOM or URL checks to pass.',
  limits: { maxSteps: 40, timeoutMs: 120000 },
  credentials: ['OPENAI_API_KEY', 'OPENAI_API_KEY_FILE', 'TYPESAFE_API_KEY']
});

export function publicTaskResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Controller returned an invalid task result.');
  const output = { ...result };
  if (result.evidence && typeof result.evidence === 'object') {
    const { screenshotBase64: _screenshot, ...evidence } = result.evidence;
    output.evidence = evidence;
  }
  return output;
}

export function errorMessage(error) {
  let message = error instanceof Error ? error.message : 'Browser task failed.';
  for (const name of ['OPENAI_API_KEY', 'TYPESAFE_API_KEY']) {
    const credential = process.env[name];
    if (credential) message = message.replaceAll(credential, '[redacted]');
  }
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 2000);
}

function taskContent(result) {
  const structuredContent = publicTaskResult(result);
  const content = [{ type: 'text', text: JSON.stringify(structuredContent) }];
  const screenshot = result.evidence?.screenshotBase64;
  if (typeof screenshot === 'string' && screenshot.length) {
    content.push({ type: 'image', data: screenshot, mimeType: 'image/png' });
  }
  return { structuredContent, content, ...(result.verified === true ? {} : { isError: true }) };
}

export function createMcpServer({ runTask = runBrowserTask } = {}) {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION }, {
    instructions: 'Use browser_capabilities to inspect support, then run_browser_task for one bounded workflow. Supply expected checks and every text value needed by the task.'
  });
  server.registerTool('browser_capabilities', {
    description: 'List supported browser operations, provider modalities, isolation, text choices, and task limits.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify(capabilities) }], structuredContent: { ...capabilities }
  }));
  server.registerTool('run_browser_task', {
    description: 'Run one bounded browser workflow in a fresh isolated browser context. The fast decision model chooses observed controls and supplied text; success is checked independently.',
    inputSchema: taskSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (task, ctx) => {
    const signal = ctx.mcpReq.signal;
    const progressToken = ctx.mcpReq._meta?.progressToken;
    let progress = 0;
    const onProgress = progressToken === undefined ? undefined : async update => {
      signal.throwIfAborted();
      progress = Number.isFinite(update?.step) && update.step > progress ? update.step : progress + 1;
      const total = Number.isFinite(update?.total) && update.total >= progress ? update.total : undefined;
      await ctx.mcpReq.notify({ method: 'notifications/progress', params: {
        progressToken, progress, ...(total === undefined ? {} : { total }),
        message: typeof update?.action === 'string' ? update.action.slice(0, 400) : 'Browser task progress'
      } });
    };
    try {
      signal.throwIfAborted();
      const result = await runTask(task, { signal, onProgress });
      signal.throwIfAborted();
      return taskContent(result);
    } catch (error) {
      if (signal.aborted) throw error;
      return { content: [{ type: 'text', text: errorMessage(error) }], isError: true };
    }
  });
  return server;
}

export function startStdioServer(options = {}) {
  return serveStdio(() => createMcpServer(options), { onerror: error => console.error(errorMessage(error)) });
}
