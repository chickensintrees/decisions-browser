import { choose, keyFromFile } from './providers.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const keyFile = process.argv[2];
const key = keyFile ? await keyFromFile(keyFile) : process.env.OPENAI_API_KEY;
const actions = [{ id: 'correct', description: 'The sum of 1 plus 1 equals 2.' }, { id: 'incorrect', description: 'The sum of 1 plus 1 equals 3.' }];
const results = [];
for (const provider of ['decisions', 'responses']) {
  try {
    const result = await choose(provider, { goal: 'Choose the correct arithmetic statement.', visibleText: '1 + 1' }, actions, { key });
    results.push({ provider, accessible: true, correct: result.choice === 'correct', ...result });
  } catch (error) { results.push({ provider, accessible: false, error: error.message }); }
}
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/preflight.json', import.meta.url), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.some(r => !r.accessible || !r.correct)) process.exitCode = 1;
