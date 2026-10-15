import assert from 'node:assert/strict';

export function lessTimePercent(fastMs, baselineMs) {
  assert.ok(Number.isFinite(fastMs) && fastMs > 0, 'Fast duration must be positive.');
  assert.ok(Number.isFinite(baselineMs) && baselineMs >= fastMs, 'Baseline must be at least as long.');
  return Number(((1 - fastMs / baselineMs) * 100).toFixed(1));
}

export function deriveClaims(report, demo) {
  assert.equal(report.runs.length, 40, 'Release evidence must retain every attempt.');
  const rows = [];
  for (const task of report.protocol.tasks) for (const observation of report.protocol.modes) {
    const group = report.runs.filter(run => run.task === task && run.observation === observation);
    const median = provider => {
      const attempts = group.filter(run => run.provider === provider);
      assert.equal(attempts.length, 5);
      const successful = attempts.filter(run => run.result.verified).map(run => run.wallMs).sort((a, b) => a - b);
      assert.ok(successful.length);
      assert.ok(attempts.every(run => !run.result.verified || run.result.trace.every(step => step.model === 'gpt-6-luna')));
      return successful.length % 2 ? successful[(successful.length - 1) / 2] : (successful[successful.length / 2 - 1] + successful[successful.length / 2]) / 2;
    };
    const decisionsMs = median('decisions');
    const responsesMs = median('responses');
    rows.push({ task, observation, decisionsMs, responsesMs, lessTimePercent: lessTimePercent(decisionsMs, responsesMs) });
  }
  assert.equal(demo.playbackSpeed, 1);
  assert.equal(demo.expectedChecks.length, 11);
  for (const lane of ['decisions', 'computerUse']) assert.equal(demo[lane].checksPassed, 11);
  const selected = demo.attempts.filter(attempt => attempt.selected);
  assert.equal(selected.length, 2);
  assert.ok(selected.every(attempt => attempt.verified && attempt.videoStartOffsetMs >= 0));
  return {
    release: {
      baseline: 'Responses API in the same MCP controller',
      model: 'gpt-6-luna',
      trials: report.runs.length,
      decisionsVerified: report.runs.filter(run => run.provider === 'decisions' && run.result.verified).length,
      responsesVerified: report.runs.filter(run => run.provider === 'responses' && run.result.verified).length,
      upToLessMedianTimePercent: Math.max(...rows.map(row => row.lessTimePercent)),
      statistic: 'Median full MCP wall time of verified attempts',
      scope: 'Two local tasks, text and image plus DOM observations, five attempts per condition, no retries',
      rows
    },
    demo: {
      decisionsMs: demo.decisions.measuredMs,
      windowsComputerUseMs: demo.computerUse.measuredMs,
      lessElapsedTimePercent: lessTimePercent(demo.decisions.measuredMs, demo.computerUse.measuredMs),
      checksPassedPerLane: 11,
      trials: 1,
      statistic: 'Page ready through independent observation of all checks passing',
      scope: 'One illustrative systems comparison; different models and control paths; Windows input recovery included; setup excluded'
    }
  };
}

export function validateClaims(claims, report, demo) {
  assert.deepEqual(claims, deriveClaims(report, demo), 'Campaign claims must match the retained evidence and scope.');
}
