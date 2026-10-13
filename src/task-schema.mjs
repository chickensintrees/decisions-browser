import * as z from 'zod/v4';

const selector = z.string().min(1).max(500);
export const checkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visible'), selector }).strict(),
  z.object({ type: z.literal('text'), selector, value: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('value'), selector, value: z.string().max(4096) }).strict(),
  z.object({ type: z.literal('checked'), selector, value: z.boolean() }).strict(),
  z.object({ type: z.literal('count'), selector, value: z.number().int().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('url'), value: z.string().min(1).max(2000), match: z.enum(['equals', 'contains']).default('contains') }).strict()
]);

export const taskSchema = z.object({
  startUrl: z.string().url().max(2000).describe('Trusted starting HTTP(S) URL. The tool opens a fresh isolated browser context.'),
  goal: z.string().min(1).max(4000).describe('One bounded browser workflow with a clear expected outcome.'),
  allowedOrigins: z.array(z.string().url().max(2000)).min(1).max(12).optional().describe('Exact HTTP(S) origins permitted for navigation and requests. Defaults to the start URL origin.'),
  textValues: z.array(z.object({ name: z.string().min(1).max(120), value: z.string().max(4096) }).strict()).max(20).default([]).describe('Approved text values for the available fields. The decision model chooses a supplied value; it never invents text.'),
  checks: z.array(checkSchema).min(1).max(20).describe('Independent DOM or URL assertions that must all pass after the model selects DONE.'),
  provider: z.enum(['decisions', 'responses', 'jev']).default('decisions'),
  observation: z.enum(['text', 'image']).default('text').describe('Image mode supplies a screenshot plus DOM-derived action descriptions.'),
  maxSteps: z.number().int().min(1).max(40).default(20),
  timeoutMs: z.number().int().min(1000).max(120000).default(60000),
  headless: z.boolean().default(true).describe('Set false only when the user requests a visible browser window.')
}).strict();

export function normalizeTask(input) {
  const task = taskSchema.parse(input);
  const normalize = value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without embedded credentials are supported.');
    return url;
  };
  const start = normalize(task.startUrl);
  const origins = task.allowedOrigins ?? [start.origin];
  task.allowedOrigins = [...new Set(origins.map(value => {
    const url = normalize(value);
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('allowedOrigins must contain origins only, without paths or query strings.');
    return url.origin;
  }))];
  if (!task.allowedOrigins.includes(start.origin)) throw new Error('The starting URL origin must appear in allowedOrigins.');
  if (task.provider === 'jev' && task.observation === 'image') throw new Error('Jev is text-only; choose observation=text.');
  if (new Set(task.textValues.map(value => value.name)).size !== task.textValues.length) throw new Error('textValues names must be unique.');
  return task;
}
