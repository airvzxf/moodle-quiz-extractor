#!/usr/bin/env node
// tools/redact-fixture.mjs
//
// Reads the raw HTML fixtures under resources/ and writes sanitized copies
// to tests/fixtures/redacted/. Replaces real Moodle session tokens, attempt
// ids, cmids, usernames, input names and id attributes with stable placeholders
// so the redacted fixtures can be safely committed and used in tests.
//
// Usage:  pnpm redact
//
// Design: each replacement uses a placeholder that *cannot* accidentally
// satisfy the canary patterns (e.g. "sesskey=__REDACTED__" not "sesskey=REDACTED"),
// so a placeholder that survives a canary check is unambiguous.
//
// The canary patterns are defined in src/diagnostics/canary-patterns.ts so
// the runtime redactor and the fixture redactor share a single source of
// truth. We import them dynamically because this script runs from Node and
// the source file is TypeScript (consumed at runtime via a tiny inline
// reimplementation; the canonical definitions live in canary-patterns.ts).

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'resources');
const DST = join(ROOT, 'tests', 'fixtures', 'redacted');

const PH = '__REDACTED__'; // underscores keep it out of [A-Za-z0-9]+

const PATTERNS = [
  // sesskey query param + hidden form field (Moodle CSRF token)
  [/sesskey=[A-Za-z0-9]+/g, `sesskey=${PH}`],
  [/name="sesskey"\s+value="[A-Za-z0-9]+"/g, `name="sesskey" value="${PH}"`],
  // Moodle session cookies (any value)
  [/MoodleSession[\w-]*=[A-Za-z0-9]+/g, `MoodleSession=${PH}`],
  // attempt / cmid query params
  [/\battempt=\d+/g, `attempt=${PH}`],
  [/\bcmid=\d+/g, `cmid=${PH}`],
  // question ids (id="question-<attempt>-<slot>")
  [/id="question-(\d+)-(\d+)"/g, `id="question-${PH}-${PH}"`],
  // real input names: q{qubaid}:{slot}_answer{n} / q{qubaid}:{slot}_choice{n}
  //                  q{qubaid}:{slot}_:flagged (hidden flag input)
  //                  q{qubaid}:{slot}_:sequencecheck
  [/name="(q\d+:\d+_[A-Za-z0-9_:-]+)"/g, `name="${PH}"`],
  // hidden values that often carry tokens/checksums
  [/<input type="hidden"[^>]+value="[^"]+"/g, `<input type="hidden" value="${PH}"`],
  // long hex blobs (Moodle checksum / token format)
  [/\b[A-Fa-f0-9]{32,}\b/g, `__CHECKSUM_REDACTED__`],
  // emails (require a TLD ≥ 2 letters and a non-numeric local-part to avoid
  // swallowing version strings like "mathjax@2.7.9" which are not PII)
  [/\b[A-Za-z][\w.+-]*@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/g, `email@${PH}.invalid`],
  // data-region answer-label preserves structure, no real text
  [/data-region="answer-label"/g, 'data-region="answer-label"'],
];

// Canary patterns detect a LEAK (a real secret that survived redaction).
// MUST stay in sync with src/diagnostics/canary-patterns.ts::CANARY_LABELS.
// Placeholders use underscores or "__" markers so they cannot satisfy these
// patterns — only a real token like "sesskey=eLDsS5Y5jR" would.
const CANARY_PATTERNS = [
  [/\battempt=\d+/, 'attempt=NNN'],
  [/\bcmid=\d+/, 'cmid=NNN'],
  [/sesskey=[A-Za-z0-9]+(?![_])/, 'sesskey=<alnum-only>'],
  [/MoodleSession[\w-]*=[A-Za-z0-9]+(?![_])/, 'MoodleSession=<alnum-only>'],
  [/name="q\d+:\d+_/, 'name="qNNN:NNN_<something>'],
  [/\b[A-Fa-f0-9]{32,}\b/, 'long-hex-blob'],
  [/\b[A-Za-z][\w.+-]*@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'email'],
];

await mkdir(DST, { recursive: true });
let count = 0;
let blocked = 0;
let sources;
let readDir;
try {
  sources = (await readdir(SRC)).filter((n) => n.endsWith('.html'));
  readDir = SRC;
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.log(
      `Note: ${SRC} is not present (gitignored; raw fixtures are developer-local).`,
    );
    console.log('Verifying the already-committed redacted fixtures instead…');
    sources = (await readdir(DST)).filter((n) => n.endsWith('.html'));
    readDir = DST;
  } else {
    throw err;
  }
}
for (const f of sources) {
  const inPath = join(readDir, f);
  const outPath = join(DST, f);
  const original = await readFile(inPath, 'utf8');
  let out = original;
  if (readDir === SRC) {
    for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  }
  // Canary: if any forbidden pattern survived, refuse to write
  const surviving = CANARY_PATTERNS.filter(([re]) => re.test(out));
  if (surviving.length > 0) {
    console.error(`✗ ${f} — redaction FAILED, ${surviving.length} canary pattern(s) still present:`);
    for (const [re, label] of surviving) console.error(`    - ${label}`);
    blocked += 1;
    continue;
  }
  await writeFile(outPath, out, 'utf8');
  console.log(`✓ ${f} (${original.length} → ${out.length} bytes)`);
  count += 1;
}
if (blocked > 0) {
  console.error(`\n${blocked} fixture(s) blocked — would have leaked secrets.`);
  process.exit(1);
}
console.log(`\nDone: ${count} fixture(s) verified, 0 blocked.`);