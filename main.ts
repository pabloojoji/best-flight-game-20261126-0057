// Canyon Medevac — Storm Rescue Run. A make.fun program/v1 entry (Node 22,
// standard library only). The game itself is the plain static files in this
// directory's game/ folder: game/index.html plus its ES modules, hand-written,
// no library, no network request, one canvas, a seeded world. This program is
// the hand-in: it copies game/ and screenshots/ from beside this file into the
// output directory and writes dossier.json there, the summary the judge reads,
// built with the vendored make.fun library (vendor/makefun-game.ts, unchanged).
// It runs twice in the grader and both runs must write the same bytes; copying
// files and building the dossier from those files is deterministic by nature.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The directory this file lives in, and the directory the entry goes to.
const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyEntryFolder(name) {
  const from = join(repoRoot, name);
  const to = join(outputDir, name);
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
copyEntryFolder('game');
copyEntryFolder('screenshots');

// The scorer's caps (reference/gate.json). Only text_max_bytes shapes the
// bytes; the rest refuse an entry the scorer would refuse: more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files in all, or a path under game/ over 1000 bytes. game/ counts
// beside /output's own 1000-entry cap, its screenshots/ and dossier.json.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
const dossierPath = join(outputDir, 'dossier.json');
writeFileSync(dossierPath, dossier);

// A one-line summary, so a local run shows what was handed in. The counts
// come from the files just copied, so the line is the same on every run.
function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    n += entry.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}
const gameFiles = countFiles(join(outputDir, 'game'));
const shotFiles = countFiles(join(outputDir, 'screenshots'));
console.log(`canyon-medevac: ${gameFiles} game files, ${shotFiles} screenshots, dossier.json ${statSync(dossierPath).size} bytes -> ${outputDir}`);
