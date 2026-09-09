import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate, hashContent, writeEvolutionRecord } from '../.codex/skills/evolution/evolution.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureNpm } from '../.codex/skills/evolution/scripts/ensure-toolchain.mjs';

test('evolution accepts pinned tested permissive candidates', () => {
  const result = evaluateCandidate({ capability_id: 'x', source_url: 'https://github.com/a/b', commit: 'abc', license: 'MIT', relevance: 1, stars: 100, tests: true, active: true }, []);
  assert.equal(result.accepted, true);
});
test('evolution rejects unsafe or duplicate candidates', () => {
  const result = evaluateCandidate({ capability_id: 'x', source_url: 'https://github.com/a/b', commit: 'abc', license: 'Unknown', install_hooks: true }, ['x']);
  assert.equal(result.accepted, false);
  assert.equal(result.reasons.length, 3);
});
test('evolution records stable content hashes', () => {
  assert.equal(hashContent('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('evolution records are valid JSON with a real terminal newline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-evolution-'));
  const file = writeEvolutionRecord(root, { evolution_id: 'EVOLUTION-TEST', decision: 'candidate' });
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(text).evolution_id, 'EVOLUTION-TEST');
  assert.equal(text.endsWith('\n'), true);
});

test('evolution record identifiers cannot escape the traceability directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-evolution-'));
  assert.throws(() => writeEvolutionRecord(root, { evolution_id: '../escape' }), /unsafe path characters/);
});

test('toolchain resolves an installed npm outside the inherited PATH', async () => {
  const result = await ensureNpm({ install: false });
  assert.equal(result.status, 'available');
  assert.match(result.executable, /npm(\.cmd)?$/i);
});
