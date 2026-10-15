#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const usage = `Compose two measured, verified browser recordings at original speed.

Usage:
  node scripts/compose-demo.mjs --left CLIP --right CLIP --left-ms MS --right-ms MS --output VIDEO.mp4

Options:
  --left-label TEXT       Default: Decisions Browser
  --right-label TEXT      Default: Standard Computer Use
  --left-offset-ms MS     Trim capture before the left task starts (default 0)
  --right-offset-ms MS    Trim capture before the right task starts (default 0)
  --hold-ms MS            Final frame hold after the longer capture (default 1500)
  --post-verify-ms MS     Keep at most this much footage after verified completion
                         (default: preserve the entire capture)
  --ffmpeg PATH           Default: FFMPEG_PATH or ffmpeg on PATH
  --ffprobe PATH          Default: FFPROBE_PATH, sibling of ffmpeg, or ffprobe
  --font-file PATH        Optional font file; common system fonts are detected
  --note TEXT             Optional footer describing the comparison scope
  --help

Supply actual verified completion measurements, relative to each trimmed task
start. Timers display tenths of a second and stop at those measurements. Shorter
captures hold their final frame; no source content is sped up. Output is silent
1920x1080 H.264 at 30 fps. An existing output file is replaced.
`;

const flags = new Map([
  ['--left', 'left'], ['--right', 'right'], ['--left-ms', 'leftMs'], ['--right-ms', 'rightMs'],
  ['--output', 'output'], ['--left-label', 'leftLabel'], ['--right-label', 'rightLabel'],
  ['--left-offset-ms', 'leftOffsetMs'], ['--right-offset-ms', 'rightOffsetMs'], ['--hold-ms', 'holdMs'],
  ['--ffmpeg', 'ffmpeg'], ['--ffprobe', 'ffprobe'], ['--font-file', 'fontFile'], ['--note', 'note'],
  ['--post-verify-ms', 'postVerifyMs']
]);

function milliseconds(value, name) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${name} must be a finite, nonnegative decimal number of milliseconds.`);
  }
  return Number(value);
}

export function validateOptions(input) {
  const options = { leftLabel: 'Decisions Browser', rightLabel: 'Standard Computer Use', leftOffsetMs: 0, rightOffsetMs: 0, holdMs: 1500,
    postVerifyMs: null, note: 'Single UI-ready to verified trial; models and control paths differ. 0.1 s clocks. Final frames held.', ...input };
  for (const key of ['left', 'right', 'output']) {
    if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`Missing --${key}.`);
    options[key] = resolve(options[key]);
  }
  for (const key of ['leftMs', 'rightMs', 'leftOffsetMs', 'rightOffsetMs', 'holdMs']) {
    if (options[key] === undefined) throw new Error(`Missing --${key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}.`);
    options[key] = milliseconds(options[key], key);
  }
  if (options.postVerifyMs !== null) options.postVerifyMs = milliseconds(options.postVerifyMs, 'postVerifyMs');
  for (const key of ['leftLabel', 'rightLabel']) {
    if (typeof options[key] !== 'string' || !options[key].trim() || [...options[key]].length > 48 || /[\x00-\x1f\x7f]/.test(options[key])) {
      throw new Error(`${key} must contain 1 to 48 characters on one line.`);
    }
    options[key] = options[key].trim();
  }
  if (typeof options.note !== 'string' || !options.note.trim() || [...options.note].length > 160 || /[\x00-\x1f\x7f]/.test(options.note)) throw new Error('note must contain 1 to 160 characters on one line.');
  options.note = options.note.trim();
  const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if ([options.output, `${options.output}.json`].some(output => samePath(output, options.left) || samePath(output, options.right))) throw new Error('Output and its metadata must differ from both input clips.');
  if (extname(options.output).toLowerCase() !== '.mp4') throw new Error('Output must use the .mp4 extension.');
  return options;
}

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const name = flags.get(flag);
    if (!name) throw new Error(`Unknown argument: ${flag}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    options[name] = value;
  }
  return validateOptions(options);
}

export function elapsedMilliseconds(positionMs, measuredMs) {
  if (!Number.isFinite(positionMs) || !Number.isFinite(measuredMs) || measuredMs < 0) throw new Error('Invalid timer measurement.');
  return Math.min(Math.max(0, positionMs), measuredMs);
}

export function formatElapsed(positionMs, measuredMs) {
  return `${(Math.round(elapsedMilliseconds(positionMs, measuredMs) / 100) / 10).toFixed(1)} s`;
}

export function compositionPlan({ leftDurationMs, rightDurationMs, leftMs, rightMs, leftOffsetMs = 0, rightOffsetMs = 0, holdMs = 1500, postVerifyMs = null, fps = 30 }) {
  for (const [name, value] of Object.entries({ leftDurationMs, rightDurationMs, leftMs, rightMs, leftOffsetMs, rightOffsetMs, holdMs })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}.`);
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error('Invalid frame rate.');
  if (postVerifyMs !== null && (!Number.isFinite(postVerifyMs) || postVerifyMs < 0)) throw new Error('Invalid postVerifyMs.');
  const leftCaptureMs = leftDurationMs - leftOffsetMs;
  const rightCaptureMs = rightDurationMs - rightOffsetMs;
  if (leftCaptureMs <= 0 || rightCaptureMs <= 0) throw new Error('A trim offset removes the entire capture.');
  // A capture may end within one frame plus its 100 ms alignment uncertainty.
  const toleranceMs = 100 + 1000 / fps;
  if (leftMs > leftCaptureMs + toleranceMs || rightMs > rightCaptureMs + toleranceMs) throw new Error('A measured task extends beyond its capture; supply a complete, aligned clip.');
  const leftActiveMs = postVerifyMs === null ? leftCaptureMs : Math.min(leftCaptureMs, leftMs + postVerifyMs);
  const rightActiveMs = postVerifyMs === null ? rightCaptureMs : Math.min(rightCaptureMs, rightMs + postVerifyMs);
  const frames = Math.ceil((Math.max(leftActiveMs, rightActiveMs, leftMs, rightMs) + holdMs) * fps / 1000);
  const durationMs = frames * 1000 / fps;
  return { fps, frames, durationMs, leftActiveMs, rightActiveMs, leftTailTrimmedMs: leftCaptureMs - leftActiveMs, rightTailTrimmedMs: rightCaptureMs - rightActiveMs, leftPaddingMs: durationMs - leftActiveMs, rightPaddingMs: durationMs - rightActiveMs };
}

function run(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveCommand(stdout) : reject(new Error(`${basename(command)} exited ${code}: ${stderr.trim()}`)));
  });
}

export async function probeVideo(path, ffprobe = 'ffprobe') {
  const info = JSON.parse(await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration:format=duration', '-of', 'json', path]));
  const stream = info.streams?.[0];
  const durationMs = Number(stream?.duration ?? info.format?.duration) * 1000;
  if (!stream || !Number.isFinite(durationMs) || durationMs <= 0 || !stream.width || !stream.height) throw new Error('Input must contain a video stream with a positive known duration.');
  return { durationMs, width: stream.width, height: stream.height };
}

function filterPath(path) {
  return `'${path.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''")}'`;
}

async function findFont(explicit) {
  if (explicit) { await access(explicit, constants.R_OK); return resolve(explicit); }
  for (const path of ['C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf']) {
    try { await access(path, constants.R_OK); return path; } catch {}
  }
  return null;
}

function elapsedExpression(measuredMs) {
  const roundedTenths = `floor(min(t\\,${(measuredMs / 1000).toFixed(6)})*10+0.5)`;
  return `Elapsed %{eif\\:floor(${roundedTenths}/10)\\:d}.%{eif\\:mod(${roundedTenths}\\,10)\\:d} s`;
}

export function buildFilterGraph(options, plan, textFiles, fontFile) {
  const font = fontFile ? `fontfile=${filterPath(fontFile)}:` : '';
  const fileText = (path, size, x, y, color, extra = '') => `drawtext=${font}textfile=${filterPath(path)}:expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}${extra}`;
  const lanes = ['left', 'right'].map((side, index) => {
    const measuredSeconds = (options[`${side}Ms`] / 1000).toFixed(6);
    const labelSize = Math.min(34, Math.floor(880 / [...options[`${side}Label`]].length));
    const durationTrim = options.postVerifyMs === null ? '' : `:duration=${(plan[`${side}ActiveMs`] / 1000).toFixed(6)}`;
    return `[${index}:v]setpts=PTS-STARTPTS,trim=start=${(options[`${side}OffsetMs`] / 1000).toFixed(6)}${durationTrim},setpts=PTS-STARTPTS,fps=${plan.fps},scale=924:786:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=924:786:(ow-iw)/2:(oh-ih)/2:color=0x111e2d,setsar=1,tpad=stop_mode=clone:stop=-1,trim=end_frame=${plan.frames},pad=960:1080:18:200:color=0x0a1220,` +
      `${fileText(textFiles[`${side}Label`], labelSize, 40, 84, '0xf0f5fa')},` +
      `drawtext=${font}text='${elapsedExpression(options[`${side}Ms`])}':fontsize=30:fontcolor=0xd6e4f2:x=40:y=140,` +
      `${fileText(textFiles.running, 26, 40, 1005, '0xa7b7c9', `:enable='lt(t,${measuredSeconds})'`)},` +
      `${fileText(textFiles[`${side}Finish`], 26, 40, 1005, '0x7ee2be', `:enable='gte(t,${measuredSeconds})'`)}[${side}]`;
  });
  return lanes.join(';\n') + `;\n[left][right]hstack=inputs=2,drawbox=x=959:y=66:w=2:h=974:color=0x314154:t=fill,` +
    `${fileText(textFiles.title, 24, 40, 22, '0xa7b7c9')},${fileText(textFiles.note, Math.min(18, Math.floor(1840 / [...options.note].length)), '(w-text_w)/2', 1055, '0x8c9eb2')}[video]`;
}

export async function composeDemo(input) {
  const options = validateOptions(input);
  const ffmpegInput = options.ffmpeg ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffmpeg = /[/\\]/.test(ffmpegInput) ? resolve(ffmpegInput) : ffmpegInput;
  const ffprobe = options.ffprobe ?? process.env.FFPROBE_PATH ?? (dirname(ffmpeg) !== '.' ? join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe');
  const [left, right, font] = await Promise.all([probeVideo(options.left, ffprobe), probeVideo(options.right, ffprobe), findFont(options.fontFile ?? process.env.FFMPEG_FONT_FILE)]);
  const plan = compositionPlan({ ...options, leftDurationMs: left.durationMs, rightDurationMs: right.durationMs });
  await mkdir(dirname(options.output), { recursive: true });
  const work = await mkdtemp(join(dirname(options.output), '.compose-demo-'));
  const files = [];
  try {
    const textFiles = {};
    let localFont = null;
    if (font) {
      const path = join(work, 'font.ttf');
      await copyFile(font, path); files.push(path); localFont = basename(path);
    }
    const copy = {
      leftLabel: options.leftLabel, rightLabel: options.rightLabel, running: 'RUNNING',
      leftFinish: `VERIFIED FINISH  |  ${formatElapsed(options.leftMs, options.leftMs)}`,
      rightFinish: `VERIFIED FINISH  |  ${formatElapsed(options.rightMs, options.rightMs)}`,
      title: 'BROWSER WORKFLOW COMPARISON  |  ORIGINAL SPEED',
      note: options.note
    };
    for (const [name, text] of Object.entries(copy)) {
      const path = join(work, `${name}.txt`);
      await writeFile(path, text, 'utf8'); files.push(path); textFiles[name] = basename(path);
    }
    const filter = join(work, 'filters.ffmpeg');
    await writeFile(filter, buildFilterGraph(options, plan, textFiles, localFont)); files.push(filter);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', options.left, '-i', options.right, '-filter_complex_threads', '1', '-filter_complex_script', filter, '-map', '[video]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', options.output], { cwd: work });
    const output = await probeVideo(options.output, ffprobe);
    if (Math.abs(output.durationMs - plan.durationMs) > 1000 / plan.fps + 1 || output.width !== 1920 || output.height !== 1080) throw new Error('Rendered output failed duration or dimensions verification.');
    const result = { output: options.output, width: 1920, height: 1080, fps: plan.fps, durationMs: output.durationMs, playbackSpeed: 1, displayPrecisionMs: 100, postVerifyMs: options.postVerifyMs, note: options.note,
      left: { input: options.left, label: options.leftLabel, measuredMs: options.leftMs, offsetMs: options.leftOffsetMs, inputDurationMs: left.durationMs, presentedDurationMs: plan.leftActiveMs, tailTrimmedMs: plan.leftTailTrimmedMs, paddingMs: plan.leftPaddingMs },
      right: { input: options.right, label: options.rightLabel, measuredMs: options.rightMs, offsetMs: options.rightOffsetMs, inputDurationMs: right.durationMs, presentedDurationMs: plan.rightActiveMs, tailTrimmedMs: plan.rightTailTrimmedMs, paddingMs: plan.rightPaddingMs } };
    await writeFile(`${options.output}.json`, JSON.stringify(result, null, 2));
    return result;
  } finally {
    for (const path of files) await rm(path, { force: true });
    await rmdir(work);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage);
    else process.stdout.write(`${JSON.stringify(await composeDemo(options), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
