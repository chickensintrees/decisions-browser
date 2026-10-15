import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveClaims, lessTimePercent, validateClaims } from '../scripts/campaign-claims.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const report = await read('../benchmarks/v0.1.0/report.json');
const demo = await read('../benchmarks/demo-2026-10-15/comparison.json');
const claims = await read('../campaign/claims.json');

test('published campaign percentages and scope are computed from every retained release attempt and demo evidence', () => {
  validateClaims(claims, report, demo);
  assert.equal(claims.release.upToLessMedianTimePercent, 78.8);
  assert.equal(claims.demo.lessElapsedTimePercent, 98.9);
  assert.equal(claims.release.decisionsVerified, 20);
  assert.equal(claims.release.responsesVerified, 19);
});

test('claim detector rejects inflated numbers, omitted failures, scope changes and incomplete recordings', () => {
  const inflated = structuredClone(claims);
  inflated.demo.lessElapsedTimePercent = 99.9;
  assert.throws(() => validateClaims(inflated, report, demo), /Campaign claims/);
  const broader = structuredClone(claims);
  broader.release.baseline = 'All computer use';
  assert.throws(() => validateClaims(broader, report, demo), /Campaign claims/);
  const omitted = structuredClone(report);
  omitted.runs = omitted.runs.filter(run => run.result.verified);
  assert.throws(() => deriveClaims(omitted, demo), /every attempt/);
  const incomplete = structuredClone(demo);
  incomplete.attempts.find(attempt => attempt.selected).videoStartOffsetMs = -1;
  assert.throws(() => deriveClaims(report, incomplete));
});

test('time reduction uses the baseline denominator and rejects invalid clocks', () => {
  assert.equal(lessTimePercent(2, 10), 80);
  for (const pair of [[0, 10], [10, 2], [NaN, 10], [1, Infinity]]) assert.throws(() => lessTimePercent(...pair));
});
