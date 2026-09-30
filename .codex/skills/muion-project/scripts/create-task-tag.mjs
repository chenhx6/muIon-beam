import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, runGit, ensureDirectory } from './project-utils.mjs';

const slug = (value, fallback, limit) => String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, limit).replace(/-+$/g, '') || fallback;
const values = value => value == null ? [] : Array.isArray(value) ? value : [value];
const output = (git, pattern, options = {}) => {
  const value = git(pattern, { allowFailure: true, ...options });
  return { status: value.status, stdout: value.stdout.trim(), stderr: value.stderr.trim() };
};

export function taskTagName({ root, task, node = null, stage = 'completed', commit }) {
  root = path.resolve(root);
  if (!/^[a-f0-9]{40}$/i.test(String(commit || ''))) throw new Error('task tag name requires a commit SHA');
  const taskSlug = slug(task, 'project-milestone', 40);
  const nodeSlug = node ? slug(node, 'node', 16) : slug(stage, 'completed', 16);
  const commitTime = Number(runGit(root, ['show', '-s', '--format=%ct', commit]).stdout.trim());
  if (!Number.isFinite(commitTime)) throw new Error('tag target has no valid commit timestamp');
  const stamp = new Date(commitTime * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
  return 't-' + taskSlug + '-' + nodeSlug + '-' + stamp + '-' + commit.slice(0, 7).toLowerCase();
}

export function createTaskTag({ root = projectRootFromHere(), task = 'project-milestone', node = null, stage = 'completed', commit = null, tag: requestedTag = null, message = '', validation = [], evidence = [], report = null, drivePath = null } = {}, { gitRunner = runGit } = {}) {
  root = path.resolve(root);
  const git = (args, options = {}) => gitRunner(root, args, options);
  const publication = JSON.parse(fs.readFileSync(path.join(root, '00_project/config/publish-policy.json'), 'utf8'));
  const branch = git(['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  if (branch !== publication.branch) throw new Error('task tags can only be created from the configured main checkout');
  const target = (commit || git(['rev-parse', 'HEAD']).stdout.trim()).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(target) || output(git, ['cat-file', '-e', target + '^{commit}']).status !== 0) throw new Error('tag target is not a local commit');
  const localHead = git(['rev-parse', 'HEAD']).stdout.trim();
  if (output(git, ['merge-base', '--is-ancestor', target, localHead]).status !== 0) throw new Error('tag target is not an ancestor of main');
  const fetch = git(['fetch', publication.remote, publication.branch], { timeout: 120000, allowFailure: true });
  if (fetch.status !== 0) throw new Error('cannot verify remote main before tagging: ' + (fetch.stderr || fetch.stdout).trim());
  const remoteMainLine = git(['ls-remote', publication.remote, 'refs/heads/' + publication.branch]).stdout.trim();
  const remoteMain = remoteMainLine.split(/\s+/)[0];
  if (!remoteMain || output(git, ['merge-base', '--is-ancestor', target, remoteMain]).status !== 0) throw new Error('tag target is not present in remote main');

  const tag = requestedTag || taskTagName({ root, task, node, stage, commit: target });
  if (!/^t-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) throw new Error('task tag must start with t- and contain only safe characters');

  const localExists = output(git, ['show-ref', '--verify', '--quiet', 'refs/tags/' + tag]).status === 0;
  const remotePlain = output(git, ['ls-remote', publication.remote, 'refs/tags/' + tag]);
  const remotePeeled = output(git, ['ls-remote', publication.remote, 'refs/tags/' + tag + '^{}']);
  if (remotePlain.stdout) {
    if (!remotePeeled.stdout) throw new Error('existing remote task tag is not annotated; refusing to replace it');
    const remoteTarget = remotePeeled.stdout.split(/\s+/)[0];
    if (remoteTarget !== target) throw new Error('existing remote task tag points to a different commit; refusing to move it');
    if (localExists && (output(git, ['cat-file', '-t', 'refs/tags/' + tag]).stdout !== 'tag' || output(git, ['rev-parse', tag + '^{}']).stdout.trim() !== target)) throw new Error('local task tag conflicts with the verified remote tag');
    return { status: 'task-tagged-idempotent', tag, commit: target, remote_tag: remoteTarget, remote_main: remoteMain };
  }
  if (localExists) {
    if (output(git, ['cat-file', '-t', 'refs/tags/' + tag]).stdout !== 'tag' || output(git, ['rev-parse', tag + '^{}']).stdout.trim() !== target) throw new Error('existing local task tag points to a different or unannotated object');
  } else {
    const note = [
      '# ' + tag, '',
      '任务：' + task,
      '计划节点：' + (node || stage),
      '交付提交：' + target,
      '变更：' + (message || '按计划节点交付经过验证的项目资产。'),
      '验证：' + (values(validation).join('；') || '详见交付回执。'),
      '限制：此 t-* 标签只记录计划节点交付，不代表正式科研结果，也不代表物理模型已验证。',
      '证据：' + (values(evidence).join('；') || '以计划 checkpoint 和交付回执为准。'),
      '报告：' + (report || '不适用于计划节点标签。'),
      'Drive：' + (drivePath || '以经过校验的 canonical mirror 记录为准。'),
      ''
    ].join('\n');
    const notePath = path.join(root, '_work/current/publish-notes', tag + '.md');
    ensureDirectory(path.dirname(notePath));
    fs.writeFileSync(notePath, note, 'utf8');
    git(['tag', '-a', tag, target, '-F', notePath]);
  }
  git(['push', publication.remote, 'refs/tags/' + tag], { timeout: 120000 });
  const peeledLine = git(['ls-remote', publication.remote, 'refs/tags/' + tag + '^{}']).stdout.trim();
  const remoteTarget = peeledLine.split(/\s+/)[0];
  if (remoteTarget !== target) throw new Error('remote task tag verification failed: ' + tag);
  return { status: 'task-tagged', tag, commit: target, remote_tag: remoteTarget, remote_main: remoteMain };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(createTaskTag({
      root: args.project_root || projectRootFromHere(), task: args.task || args.topic, node: args.node, stage: args.stage,
      commit: args.commit, tag: args.tag, message: args.message, validation: args.validation, evidence: args.evidence,
      report: args.report, drivePath: args.drive_path
    }), null, 2));
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
