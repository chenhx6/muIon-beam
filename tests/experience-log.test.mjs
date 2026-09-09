import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordExperience } from '../.codex/skills/muion-project/scripts/record-experience.mjs';
import { summarizeExperiences } from '../.codex/skills/muion-project/scripts/summarize-experiences.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-experiences-'));
  fs.mkdirSync(path.join(root, '00_project/traceability/experiences'), { recursive: true });
  return root;
}

function record(id, polarity) {
  return {
    experience_id: id,
    polarity,
    category: 'test-category',
    title: `${polarity} test experience`,
    observation: 'A bounded fixture observation.',
    evidence: ['fixture evidence'],
    impact: ['fixture impact'],
    reusable_value: 'A reusable fixture lesson.',
    actions: ['keep the test deterministic'],
    tags: ['testing', polarity],
  };
}

test('experience records accept positive and negative events and summarize them', () => {
  const root = fixture();
  recordExperience(root, record('EXP-20260909-positive', 'positive'));
  recordExperience(root, record('EXP-20260909-negative', 'negative'));
  assert.throws(() => recordExperience(root, record('EXP-20260909-positive', 'positive')), /already exists/);
  const summary = summarizeExperiences(root, 'test-category');
  assert.equal(summary.count, 2);
  assert.equal(summary.counts.positive, 1);
  assert.equal(summary.counts.negative, 1);
  const text = fs.readFileSync(summary.file, 'utf8');
  assert.match(text, /正向：1；负向：1/);
  assert.match(text, /positive test experience/);
  assert.match(text, /negative test experience/);
});
