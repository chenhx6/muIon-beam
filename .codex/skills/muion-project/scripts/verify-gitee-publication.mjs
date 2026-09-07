import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, runGit, jsonRead } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const tag = args.tag;
if (!tag) throw new Error('provide --tag');
const localCommit = runGit(root, ['rev-list', '-n', '1', tag]).stdout.trim();
const remoteMain = runGit(root, ['ls-remote', 'origin', 'refs/heads/main']).stdout.trim().split(/\s+/)[0];
const remoteTagLine = runGit(root, ['ls-remote', 'origin', `refs/tags/${tag}`]).stdout.trim();
const peeledLine = runGit(root, ['ls-remote', 'origin', `refs/tags/${tag}^{}`], { allowFailure: true }).stdout.trim();
const remoteTag = (peeledLine || remoteTagLine).split(/\s+/)[0] || null;
const tagIsAncestor = remoteTag ? runGit(root, ['merge-base', '--is-ancestor', remoteTag, localCommit], { allowFailure: true }).status === 0 : false;
const publicationPath = path.join(root, '00_project/traceability/publication-records', `${tag}.json`);
const publication = fs.existsSync(publicationPath) ? jsonRead(publicationPath) : null;
const result = { tag, local_commit: localCommit, remote_main: remoteMain, remote_tag: remoteTag, tag_is_ancestor_of_local: tagIsAncestor, publication, valid: remoteTag && (remoteTag === localCommit || tagIsAncestor) && remoteMain === runGit(root, ['rev-parse', 'HEAD']).stdout.trim() && (publication ? publication.status === 'published' : true) };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.valid ? 0 : 1;
