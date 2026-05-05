#!/usr/bin/env node
// vrtini quality gate, adapted from
// https://blog.codeminer42.com/stop-reading-ai-code-start-measuring-it-a-rails-playbook/
//
// Five metrics in the playbook; we ship four (mutation testing skipped
// because it's too expensive for a fast feedback loop):
//
//   1. Coverage          — vitest + @vitest/coverage-v8 (line + branch)
//   2. Complexity        — eslint `complexity` rule (per-function cyclomatic)
//   3. Function length   — eslint `max-lines-per-function`
//   4. File length       — eslint `max-lines`
//   5. Param count       — eslint `max-params`
//   6. Cyclic deps       — madge --circular
//
// Thresholds live in tools/quality-thresholds.json. The eslint rules are
// configured at the *playbook's strict thresholds* but emit `warn` (not
// `error`), so they never fail `npm run lint`. This script counts the
// warnings per rule and compares to the thresholds file. The intent is a
// ratchet: today's counts become the ceiling. New violations fail; fixing
// existing ones tightens the ratchet on the next bump.
//
// Run: `npm run quality` — exits 0 if all gates pass, 1 if any fail.
//      `npm run quality:bump` rewrites the thresholds file from current
//      measurements (use after a deliberate refactor that lowered counts).

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const THRESHOLDS_PATH = resolve(ROOT, 'tools/quality-thresholds.json');
const COVERAGE_SUMMARY_PATH = resolve(ROOT, 'tmp/quality/coverage/coverage-summary.json');

const TRACKED_RULES = [
  'complexity',
  'max-lines-per-function',
  'max-lines',
  'max-params',
];

const args = process.argv.slice(2);
const isBump = args.includes('--bump');
const skipCoverage = args.includes('--skip-coverage');

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', ...opts });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status ?? 0 };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function loadThresholds() {
  if (!existsSync(THRESHOLDS_PATH)) {
    return null;
  }
  return readJson(THRESHOLDS_PATH);
}

function measureCoverage() {
  if (skipCoverage) {
    console.log('• coverage: skipped (--skip-coverage)');
    return null;
  }
  console.log('• coverage: running vitest with --coverage…');
  run('npx vitest run --coverage --silent');
  const summary = readJson(COVERAGE_SUMMARY_PATH);
  return {
    lines: summary.total.lines.pct,
    branches: summary.total.branches.pct,
    functions: summary.total.functions.pct,
    statements: summary.total.statements.pct,
  };
}

function measureEslintViolations() {
  console.log('• eslint: counting warnings on tracked rules…');
  const res = runCapture('npx', ['eslint', 'src', 'web/server', '--format', 'json']);
  // eslint exits non-zero when there are errors; warnings alone keep it 0.
  // We accept any exit code as long as JSON parses.
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    console.error('eslint did not produce parseable JSON. stderr:\n' + res.stderr);
    process.exit(2);
  }

  const counts = Object.fromEntries(TRACKED_RULES.map((r) => [r, 0]));
  const samples = Object.fromEntries(TRACKED_RULES.map((r) => [r, []]));
  const errorMessages = [];

  for (const file of report) {
    for (const msg of file.messages ?? []) {
      if (msg.severity === 2 && !TRACKED_RULES.includes(msg.ruleId ?? '')) {
        errorMessages.push(`${file.filePath}:${msg.line} ${msg.ruleId} ${msg.message}`);
      }
      if (!msg.ruleId || !TRACKED_RULES.includes(msg.ruleId)) continue;
      counts[msg.ruleId] += 1;
      if (samples[msg.ruleId].length < 3) {
        const rel = file.filePath.replace(ROOT + '/', '');
        samples[msg.ruleId].push(`${rel}:${msg.line}`);
      }
    }
  }

  if (errorMessages.length > 0) {
    console.error('eslint produced errors (not just warnings):');
    for (const line of errorMessages.slice(0, 10)) console.error('  ' + line);
    process.exit(2);
  }

  return { counts, samples };
}

function measureCircularDeps() {
  console.log('• madge: scanning for circular dependencies…');
  const res = runCapture('npx', [
    'madge',
    '--circular',
    '--extensions',
    'ts',
    '--ts-config',
    'tsconfig.json',
    'src',
    'web/server',
  ]);
  // madge exits 1 when cycles found, 0 when clean.
  const lines = res.stdout.split('\n');
  // Lines like "1) src/foo.ts > src/bar.ts > src/foo.ts"
  const cycles = lines.filter((l) => /^\s*\d+\)/.test(l)).length;
  return { cycles };
}

function buildSnapshot() {
  const coverage = measureCoverage();
  const { counts, samples } = measureEslintViolations();
  const circular = measureCircularDeps();

  return {
    coverage,
    eslintWarnings: counts,
    eslintSamples: samples,
    circularDependencies: circular.cycles,
  };
}

function fmtPct(v) {
  return v == null ? 'n/a' : `${v.toFixed(2)}%`;
}

function compare(name, measured, threshold, mode) {
  // mode: 'min' (measured must be >=), 'max' (measured must be <=)
  if (threshold == null) return { name, measured, threshold, status: 'baseline' };
  const ok = mode === 'min' ? measured >= threshold : measured <= threshold;
  return { name, measured, threshold, status: ok ? 'pass' : 'fail', mode };
}

function reportTable(results) {
  const cols = ['metric', 'measured', 'threshold', 'status'];
  const rows = results.map((r) => {
    const fmt = (v) => (typeof v === 'number' ? r.name.includes('coverage') ? fmtPct(v) : String(v) : v);
    return [r.name, fmt(r.measured), fmt(r.threshold), r.status.toUpperCase()];
  });
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...rows.map((row) => String(row[i] ?? '').length))
  );
  const fmt = (row) =>
    row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ');
  console.log('');
  console.log(fmt(cols));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) console.log(fmt(row));
}

function gate(snapshot, thresholds) {
  const results = [];

  if (snapshot.coverage) {
    results.push(compare('coverage.lines', snapshot.coverage.lines, thresholds.coverage?.lines, 'min'));
    results.push(compare('coverage.branches', snapshot.coverage.branches, thresholds.coverage?.branches, 'min'));
  }

  for (const rule of TRACKED_RULES) {
    results.push(
      compare(
        `eslint.${rule}`,
        snapshot.eslintWarnings[rule],
        thresholds.eslintWarnings?.[rule],
        'max'
      )
    );
  }

  results.push(
    compare(
      'circular-deps',
      snapshot.circularDependencies,
      thresholds.circularDependencies,
      'max'
    )
  );

  reportTable(results);

  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length > 0) {
    console.log('');
    console.log(`✗ ${failed.length} gate(s) failed:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: measured ${f.measured}, ${f.mode === 'min' ? 'min' : 'max'} ${f.threshold}`);
      const samples = snapshot.eslintSamples?.[f.name.replace(/^eslint\./, '')];
      if (samples?.length) {
        for (const s of samples) console.log(`      ${s}`);
      }
    }
    return 1;
  }

  console.log('\n✓ all quality gates pass');
  return 0;
}

// ─── main ────────────────────────────────────────────────────────────────────

const snapshot = buildSnapshot();

if (isBump) {
  const next = {
    coverage: snapshot.coverage
      ? {
          lines: Math.floor(snapshot.coverage.lines * 100) / 100,
          branches: Math.floor(snapshot.coverage.branches * 100) / 100,
        }
      : null,
    eslintWarnings: snapshot.eslintWarnings,
    circularDependencies: snapshot.circularDependencies,
  };
  writeJson(THRESHOLDS_PATH, next);
  console.log(`\n✓ wrote ratchet snapshot to ${THRESHOLDS_PATH}`);
  console.log(JSON.stringify(next, null, 2));
  process.exit(0);
}

const thresholds = loadThresholds();
if (!thresholds) {
  console.error(`No ${THRESHOLDS_PATH} — run \`npm run quality:bump\` first to capture a baseline.`);
  process.exit(2);
}

const code = gate(snapshot, thresholds);
process.exit(code);
