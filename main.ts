// Token Launch Radar entrypoint (Node 22, standard library only, deterministic output).
//
// Reads the sealed DefiLlama snapshot from --input (default /input/snapshot.json), ranks 200
// pre-token protocols using the five-factor model in lib/model.ts, writes /output/board.json
// and /output/data.js, copies dashboard/ and screenshots/ into /output, and generates
// /output/dossier.json via buildDossier from vendor/makefun-board.ts.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, parseSnapshot, serializeDataScript, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const VALID_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function resolveCliArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1]!;
  }
  const prefixed = process.argv.find((arg) => arg.startsWith(`--${flag}=`));
  return prefixed !== undefined ? prefixed.slice(flag.length + 3) : fallback;
}

function copyDirectoryFiles(srcDir: string, destDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir)
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const copied: string[] = [];
  for (const name of names) {
    const srcPath = join(srcDir, name);
    if (!statSync(srcPath).isFile()) continue;
    copyFileSync(srcPath, join(destDir, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = resolveCliArg('input', '/input/snapshot.json');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`token-radar: snapshot not found at ${inputPath}\n`);
  process.exit(2);
}

const outputDir = resolveCliArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const validationError = validateBoard(board, snapshot);
if (validationError !== null) {
  process.stderr.write(`token-radar: board validation failed: ${validationError}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), serializeDataScript(radar));

const dashFiles = copyDirectoryFiles(join(ROOT_DIR, 'dashboard'), join(outputDir, 'dashboard'));
for (const name of dashFiles) {
  if (!VALID_FILE_NAME.test(name)) {
    process.stderr.write(`token-radar: invalid dashboard filename ${name}\n`);
    process.exit(1);
  }
  const content = readFileSync(join(outputDir, 'dashboard', name), 'utf8');
  if (/https?:\/\//i.test(content)) {
    process.stderr.write(`token-radar: network URL detected in dashboard/${name}\n`);
    process.exit(1);
  }
}
const shotFiles = copyDirectoryFiles(join(ROOT_DIR, 'screenshots'), join(outputDir, 'screenshots'));

if (shotFiles.length < 3 || shotFiles.length > 4) {
  process.stderr.write(`token-radar: expected 3-4 screenshots in screenshots/, found ${shotFiles.length}\n`);
  process.exit(1);
}
for (const name of shotFiles) {
  if (!VALID_FILE_NAME.test(name)) {
    process.stderr.write(`token-radar: invalid screenshot filename ${name}\n`);
    process.exit(1);
  }
}

const dossierBytes = buildDossier(outputDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: DASHBOARD_CAPS,
});
writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);

process.stdout.write(
  `token-radar: scored ${board.length} pre-token protocols (${radar.counts.watchlist_count} watchlist + ${radar.counts.early_count} early radar; ${radar.counts.live_token_excluded} live-token excluded)\n` +
    `token-radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${dashFiles.length} dashboard files, ${shotFiles.length} screenshots, and ${join(outputDir, 'dossier.json')} (${dossierBytes.length} bytes)\n`,
);
