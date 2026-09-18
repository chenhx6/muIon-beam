import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = path.resolve(import.meta.dirname, '..');
const cli = path.join(project, '.codex/skills/farmer/farmer.mjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-farmer-control-')); const home = path.join(root, 'codex-home');
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '00_project/config'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '_work/\n');
  for (const args of [['init','-b','main'], ['config','user.name','test'], ['config','user.email','test@example.invalid']]) assert.equal(spawnSync('git', args, { cwd: root, encoding:'utf8' }).status, 0);
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n'); spawnSync('git', ['add','.'], { cwd: root }); spawnSync('git', ['commit','-m','base'], { cwd: root });
  fs.writeFileSync(path.join(root, '00_project/config/farmer.json'), JSON.stringify({ schema_version:1, poll_interval_ms:10, watchdog_ms:100, max_attempts:3, recovery_message:'resume', recoverable_codes:['server_overloaded'], recoverable_patterns:[] }));
  return { root, home, run: (...args) => spawnSync(process.execPath, [cli, ...args, '--project-root', root, '--codex-home', home], { cwd: project, encoding:'utf8', windowsHide:true, timeout:10000 }) };
}
test('disabled farmer CLI commands are no-ops and never create a daemon', t => {
  const f=fixture(t); const disable=f.run('disable'); assert.equal(disable.status,0); assert.equal(JSON.parse(disable.stdout).status,'disabled');
  for (const command of ['ensure','start','once','retry']) {
    const args=command==='retry'?['retry','--session','unknown']: [command]; const r=f.run(...args); assert.equal(r.status,0,`${command}: ${r.stderr}`); assert.match(r.stdout,/disabled/);
  }
  assert.equal(fs.existsSync(path.join(f.root,'_work/current/farmer/lock.json')),false);
  assert.match(spawnSync('git', ['check-ignore', '_work/current/farmer/control.json'], { cwd:f.root, encoding:'utf8' }).stdout, /control\.json/);
  const supervisor = spawnSync(process.execPath, [path.join(project,'11_tools/project-supervisor/index.mjs'),'enter','--project-root',f.root], { cwd: project, encoding:'utf8', windowsHide:true, timeout:10000 });
  assert.equal(supervisor.status,0,supervisor.stderr); assert.match(supervisor.stdout,/disabled/); assert.equal(fs.existsSync(path.join(f.root,'_work/current/project-supervisor/daemon.json')),false);
});
