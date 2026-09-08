import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('sync-state schema exposes snapshot and metadata commit fields', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', '00_project/schemas/sync-state.schema.json'), 'utf8'));
  assert.ok(schema.properties.snapshot_commit);
  assert.ok(schema.properties.metadata_commit);
});

