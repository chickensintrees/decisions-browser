import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const comparisons = [];
for (const mode of ['text', 'image']) {
  const report = JSON.parse(await readFile(new URL(`./results/${mode}/report.json`, import.meta.url), 'utf8'));
  const decisions = report.summary.find(row => row.provider === 'decisions');
  const responses = report.summary.find(row => row.provider === 'responses');
  if (!decisions || !responses || decisions.passed !== decisions.attempts || responses.passed !== responses.attempts) throw new Error('Comparison includes unsuccessful trials; inspect raw reports before publishing a speedup.');
  comparisons.push({
    observation: mode === 'image' ? 'Screenshot plus DOM-derived available action descriptions' : 'Rendered DOM text, form values, and available action descriptions',
    runsPerProvider: decisions.attempts, decisionsMedianTaskSeconds: decisions.medianSuccessfulTaskMs / 1000,
    responsesMedianTaskSeconds: responses.medianSuccessfulTaskMs / 1000,
    taskSpeedup: responses.medianSuccessfulTaskMs / decisions.medianSuccessfulTaskMs,
    decisionsMedianApiMs: decisions.medianModelMs, responsesMedianApiMs: responses.medianModelMs,
    returnedModels: [...new Set([...decisions.returnedModels, ...responses.returnedModels])], report: `./${mode}/report.json`
  });
}
const sourceAtDelivery = {};
for (const file of ['benchmark.mjs', 'providers.mjs', 'runtime.mjs', 'verifier.mjs', 'fixture.html']) {
  sourceAtDelivery[file] = createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex');
}
const summary = {
  measuredAt: new Date().toISOString(), comparisons,
  limits: ['One synthetic local hotel-search task; five fresh browser contexts per provider per input mode.', 'Image trials have DOM assistance; this is not screenshot-only or native desktop automation.', 'This measures a custom controller, not ChatGPT built-in Computer Use.', 'Jev adapter was reviewed but not tested live because no TypeSafe credential was provided.', 'Controller source gained image mode after text trials. Delivery hashes identify the final files, not a captured execution snapshot of the earlier text trials.'],
  sourceAtDelivery
};
await writeFile(new URL('./results/comparison.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ comparisons, result: new URL('./results/comparison.json', import.meta.url).pathname }, null, 2));
