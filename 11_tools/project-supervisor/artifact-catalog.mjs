import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sha256File } from '../../.codex/skills/muion-project/scripts/project-utils.mjs';
import { classifyLocalArtifactPath, matchesQuarantineManifest, readQuarantineManifestEntries } from './local-runtime-paths.mjs';

export class ArtifactCatalog {
  constructor(root) { this.root = root; this.directory = path.join(root, '_work/current/artifact-triage'); }
  inspect(session) {
    if (session.mode !== 'worktree') return { session_id: session.session_id, artifacts: [], scope: 'private-worktree-only' };
    const list = args => {
      const result = spawnSync('git', ['-C', session.worktree_path, 'ls-files', '-z', '--others', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
      if (result.status !== 0) throw new Error(result.stderr || 'artifact listing failed');
      return result.stdout.split('\0').filter(Boolean);
    };
    const ignored = new Set(list(['--ignored','--exclude-standard']));
    const paths = [...new Set([...list(['--exclude-standard']), ...ignored])];
    const quarantineEntries = readQuarantineManifestEntries(session.worktree_path);
    const artifacts = [];
    for (const relative of paths) {
      const category = classifyLocalArtifactPath(relative);
      if (category === 'local-runtime' || category === 'quarantine-manifest') continue;
      const absolute = path.resolve(session.worktree_path,relative);
      if (!absolute.startsWith(path.resolve(session.worktree_path)+path.sep)) throw new Error('artifact escaped worktree');
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(absolute).startsWith(fs.realpathSync(session.worktree_path)+path.sep)) {
        artifacts.push({path:relative,status:'retained-blocked',reason:'nonregular-or-external-target',next_action:'inspect link target without copying or deleting'}); continue;
      }
      const sha256 = sha256File(absolute);
      if (category === 'quarantine') {
        const registered = matchesQuarantineManifest(quarantineEntries, relative, stat.size, sha256);
        artifacts.push({ path:relative, bytes:stat.size, sha256, ignored_by_git:ignored.has(relative), status:registered ? 'registered-quarantine' : 'retained-blocked', quarantine_registered:registered, reason:registered ? 'manifest-registered-copy' : 'quarantine-copy-without-matching-manifest', next_action:registered ? 'retain as a separately tracked quarantine copy' : 'reconcile the copy against its quarantine manifest' });
        continue;
      }
      artifacts.push({ path:relative, bytes:stat.size, sha256, ignored_by_git:ignored.has(relative), status:'unregistered', next_action:'register output destination or include eligible source in a validated checkpoint' });
    }
    const record = { schema_version:1, session_id:session.session_id, task_id:session.task_id, branch:session.branch, inspected_at:new Date().toISOString(), artifacts };
    const key = crypto.createHash('sha256').update(session.session_id).digest('hex').slice(0,24);
    fs.mkdirSync(this.directory,{recursive:true});
    const file=path.join(this.directory,`${key}.json`); const temp=`${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(record,null,2)+'\n'); fs.renameSync(temp,file);
    return record;
  }
}
