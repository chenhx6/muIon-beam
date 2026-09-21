import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { canonicalDriveMirrorRoot, defaultProjectMirrorPath, defaultRunMirrorPath, defaultExternalLibraryMirrorRoot } from '../.codex/skills/muion-project/scripts/drive-layout.mjs';

test('new Drive defaults use one local-relative canonical mirror', () => {
  assert.equal(canonicalDriveMirrorRoot('C:/archive'), path.resolve('C:/archive'));
  assert.equal(defaultProjectMirrorPath('C:/archive'), path.resolve('C:/archive'));
  assert.equal(defaultRunMirrorPath('C:/project', 'C:/project/03_runs/formal/RUN-x', 'RUN-x', undefined), path.join(path.resolve('H:/我的云端硬盘/muIon_archive/muIon-beam'), '03_runs/formal/RUN-x'));
  assert.equal(defaultExternalLibraryMirrorRoot('C:/archive'), path.resolve('C:/archive'));
});
