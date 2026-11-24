// Token radar entry for make.fun token-radar-01 (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), fits the value model on the protocols
// that already trade, ranks every pre-token protocol, and writes /output: board.json, data.js (the page's data),
// dashboard/, screenshots/ and dossier.json. Output is a pure function of the snapshot: no clock, no randomness.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback;
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !statSync(join(from, name)).isFile()) continue;
    copyFileSync(join(from, name), join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, fit } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: { version: 'radar-2', fitted_on: fit.n, held_out: fit.held_out.full, cross_validated: fit.cross_validated.full }, rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
const files = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3`);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -`);

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const hold = fit.held_out.full;
process.stdout.write(
  `token radar: ${radar.counts.protocols} protocols, ${radar.counts.watchlist} on the watchlist, ${board.length} rows (${radar.counts.early} beyond it), model fitted on ${fit.n} live tokens\n` +
    `token radar: held-out R2 ${hold.r2.toFixed(2)}, median error x${hold.median_factor.toFixed(2)}; wrote ${files.length} dashboard files and ${shots.length} screenshots\n`,
);
