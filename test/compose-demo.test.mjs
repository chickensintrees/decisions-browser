import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compositionPlan, elapsedMilliseconds, formatElapsed, parseArgs, probeVideo } from '../scripts/compose-demo.mjs';

test('elapsed clocks clamp independently at supplied measured completion times', () => {
  assert.equal(elapsedMilliseconds(-10, 250), 0);
  assert.equal(elapsedMilliseconds(123.456, 250), 123.456);
  assert.equal(elapsedMilliseconds(500, 250), 250);
  assert.equal(elapsedMilliseconds(500, 650), 500);
  assert.equal(formatElapsed(4000, 2006.8), '2.0 s');
  assert.equal(formatElapsed(1200, 2450), '1.2 s');
  assert.equal(formatElapsed(9000, 2450), '2.5 s');
  assert.throws(() => elapsedMilliseconds(Infinity, 250));
  assert.throws(() => elapsedMilliseconds(100, -1));
});

test('padding preserves source duration after capture offsets and includes a final hold', () => {
  const plan = compositionPlan({ leftDurationMs: 1200, rightDurationMs: 2200, leftOffsetMs: 200, rightOffsetMs: 500, leftMs: 950, rightMs: 1600, holdMs: 300, fps: 30 });
  assert.equal(plan.durationMs, 2000);
  assert.equal(plan.leftPaddingMs, 1000);
  assert.equal(plan.rightPaddingMs, 300);
  assert.equal(plan.frames, 60);
  assert.throws(() => compositionPlan({ leftDurationMs: 100, rightDurationMs: 200, leftOffsetMs: 100, leftMs: 50, rightMs: 100 }), /entire capture/);
  assert.throws(() => compositionPlan({ leftDurationMs: 100, rightDurationMs: 200, leftMs: 5000, rightMs: 100 }), /beyond its capture/);
  const rounded = compositionPlan({ leftDurationMs: 411, rightDurationMs: 712, leftMs: 400, rightMs: 700, holdMs: 200 });
  assert.equal(rounded.frames, 28);
  assert.ok(rounded.durationMs >= 912 && rounded.durationMs < 912 + 1000 / 30);
});

test('CLI rejects missing or invalid measurements and output/input collisions', () => {
  const base = ['--left', 'left.webm', '--right', 'right.webm', '--left-ms', '250.25', '--right-ms', '650', '--output', 'out.mp4'];
  const options = parseArgs([...base, '--left-offset-ms', '100']);
  assert.equal(options.leftMs, 250.25);
  assert.equal(options.leftOffsetMs, 100);
  assert.equal(options.leftLabel, 'Decisions Browser');
  assert.equal(options.postVerifyMs, null);
  assert.equal(parseArgs([...base, '--post-verify-ms', '500']).postVerifyMs, 500);
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(base.slice(0, -2)), /Missing --output/);
  for (const invalid of ['NaN', 'Infinity', '-1', '1s', '']) {
    assert.throws(() => parseArgs(base.map((value, index) => index === 5 ? invalid : value)));
  }
  assert.throws(() => parseArgs([...base, '--left-ms', '1']), /Duplicate/);
  assert.throws(() => parseArgs([...base, '--speed', '2']), /Unknown/);
  assert.throws(() => parseArgs(base.map(value => value === 'out.mp4' ? 'left.webm' : value)), /differ/);
  assert.throws(() => parseArgs(base.map(value => value === 'left.webm' ? 'out.mp4.json' : value)), /differ/);
  assert.throws(() => parseArgs(base.map(value => value === 'out.mp4' ? 'out.gif' : value)), /mp4/);
  assert.throws(() => parseArgs([...base, '--left-label', 'invalid\nlabel']), /one line/);
  assert.throws(() => parseArgs([...base, '--note', 'x'.repeat(161)]), /note/);
});

test('optional post-verification trimming removes only capture tail and preserves verified completion', () => {
  const source = { leftDurationMs: 6000, rightDurationMs: 9000, leftOffsetMs: 1000, rightOffsetMs: 2000, leftMs: 2300, rightMs: 5100, holdMs: 100 };
  const unchanged = compositionPlan(source);
  assert.equal(unchanged.leftActiveMs, 5000); assert.equal(unchanged.rightActiveMs, 7000);
  const trimmed = compositionPlan({ ...source, postVerifyMs: 500 });
  assert.equal(trimmed.leftActiveMs, 2800); assert.equal(trimmed.rightActiveMs, 5600);
  assert.equal(trimmed.leftTailTrimmedMs, 2200); assert.equal(trimmed.rightTailTrimmedMs, 1400);
  assert.ok(trimmed.leftActiveMs >= source.leftMs && trimmed.rightActiveMs >= source.rightMs);
  assert.equal(trimmed.durationMs, 5700);
  const atCompletion = compositionPlan({ ...source, postVerifyMs: 0 });
  assert.equal(atCompletion.leftActiveMs, source.leftMs); assert.equal(atCompletion.rightActiveMs, source.rightMs);
  const shortTail = compositionPlan({ ...source, leftDurationMs: 3500, postVerifyMs: 500 });
  assert.equal(shortTail.leftActiveMs, 2500); assert.equal(shortTail.leftTailTrimmedMs, 0);
  assert.throws(() => compositionPlan({ ...source, postVerifyMs: -1 }), /postVerifyMs/);
});

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
test('real FFmpeg composition renders aligned 1x content, holds final frames, and verifies output duration', { timeout: 60000 }, async context => {
  const features = spawnSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true });
  const probe = spawnSync(ffprobe, ['-version'], { windowsHide: true });
  if (features.status !== 0 || !/\bdrawtext\b/.test(features.stdout) || probe.status !== 0) {
    context.skip('FFmpeg with drawtext and ffprobe are required for video smoke.');
    return;
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outputDir = join(root, 'artifacts', 'demo', `compose-smoke-${Date.now()}`, "quoted path's, test");
  await mkdir(outputDir, { recursive: true });
  const left = join(outputDir, 'left.mp4'), right = join(outputDir, 'right.mp4'), output = join(outputDir, 'comparison.mp4');
  const encode = (source, path) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-fps_mode', 'passthrough', '-pix_fmt', 'yuv420p', path], { windowsHide: true });
  encode("color=c=red:s=160x90:r=10:d=0.5,drawbox=x=0:y=0:w=iw:h=ih:color=lime:t=fill:enable='gte(t,0.3)',setpts=PTS+1/TB", left);
  encode('color=c=blue:s=160x90:r=10:d=0.7', right);
  const rendered = spawnSync(process.execPath, [resolve(root, 'scripts/compose-demo.mjs'), '--left', left, '--right', right, '--left-ms', '250', '--right-ms', '650', '--left-offset-ms', '100', '--hold-ms', '200', '--output', output, '--left-label', 'Decisions: 100% [safe]', '--right-label', 'W'.repeat(48), '--note', 'Synthetic compositor smoke only. Clocks rounded to 0.1 s; shorter capture holds.', '--ffmpeg', ffmpeg, '--ffprobe', ffprobe], { encoding: 'utf8', windowsHide: true });
  assert.equal(rendered.status, 0, rendered.stderr);
  const metadata = JSON.parse(rendered.stdout);
  assert.equal(metadata.left.measuredMs, 250);
  assert.equal(metadata.left.offsetMs, 100);
  assert.equal(metadata.left.label, 'Decisions: 100% [safe]');
  assert.equal(metadata.playbackSpeed, 1);
  const video = await probeVideo(output, ffprobe);
  assert.equal(video.width, 1920); assert.equal(video.height, 1080);
  assert.ok(Math.abs(video.durationMs - 900) <= 34, JSON.stringify(video));
  const pixel = (seconds, x) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', output, '-vf', `crop=2:2:${x}:600,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
  const red = pixel(0.05, 480), green = pixel(0.25, 480), held = pixel(0.8, 480), blue = pixel(0.8, 1440);
  assert.ok(red[0] > 180 && red[1] < 80, `Trimmed start should still be red: ${red}`);
  assert.ok(green[1] > 180 && green[0] < 80, `Source color change should occur at original speed: ${green}`);
  assert.ok(held[1] > 180 && held[0] < 80, `Left final frame should hold after its clip ends: ${held}`);
  assert.ok(blue[2] > 180 && blue[0] < 80, `Right lane must contain its own clip: ${blue}`);
  const clock = (seconds, x) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds), '-i', output, '-vf', `crop=500:50:${x}:130,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
  const changedGlyphPixels = (a, b) => {
    assert.equal(a.length, b.length);
    let changed = 0;
    for (let index = 0; index < a.length; index += 3) {
      const ink = data => data[index] + data[index + 1] + data[index + 2] > 330;
      if (ink(a) !== ink(b)) changed++;
    }
    return changed;
  };
  const leftClockChange = changedGlyphPixels(clock(0.5, 30), clock(0.8, 30));
  const rightClockChange = changedGlyphPixels(clock(0.5, 990), clock(0.8, 990));
  assert.ok(leftClockChange <= 8, `Rendered left clock must stay clamped; ${leftClockChange} glyph pixels changed.`);
  assert.ok(rightClockChange > leftClockChange + 20, `The independent right clock must advance; ${rightClockChange} glyph pixels changed.`);
  for (const [name, seconds] of [['01-running', 0.1], ['02-left-finished', 0.5], ['03-both-finished', 0.85]]) {
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(seconds), '-i', output, '-frames:v', '1', join(outputDir, `${name}.png`)], { windowsHide: true });
  }
  const saved = JSON.parse(await readFile(`${output}.json`, 'utf8'));
  assert.equal(saved.right.measuredMs, 650);
  const trimmedOutput = join(outputDir, 'trimmed-comparison.mp4');
  const trimmed = spawnSync(process.execPath, [resolve(root, 'scripts/compose-demo.mjs'), '--left', left, '--right', right, '--left-ms', '250', '--right-ms', '550', '--left-offset-ms', '100', '--post-verify-ms', '50', '--hold-ms', '200', '--output', trimmedOutput, '--ffmpeg', ffmpeg, '--ffprobe', ffprobe], { encoding: 'utf8', windowsHide: true });
  assert.equal(trimmed.status, 0, trimmed.stderr);
  const trimmedMetadata = JSON.parse(trimmed.stdout);
  assert.equal(trimmedMetadata.left.measuredMs, 250); assert.equal(trimmedMetadata.right.measuredMs, 550);
  assert.equal(trimmedMetadata.left.presentedDurationMs, 300); assert.equal(trimmedMetadata.right.presentedDurationMs, 600);
  assert.equal(trimmedMetadata.left.tailTrimmedMs, 100); assert.equal(trimmedMetadata.right.tailTrimmedMs, 100);
  assert.ok(Math.abs((await probeVideo(trimmedOutput, ffprobe)).durationMs - 800) <= 34);
  console.log(`Composition tour: ${outputDir}`);
});
