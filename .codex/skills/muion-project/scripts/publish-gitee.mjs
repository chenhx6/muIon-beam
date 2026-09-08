import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit, ensureDirectory, jsonWrite, nowIso } from './project-utils.mjs';
import { resolveBaseContentVerification } from './base-content-verification.mjs';
import { classifyPaths } from './delivery-plan.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const tag = args.tag;
const baseTag = args.base_tag || null;
const baseVerification = resolveBaseContentVerification(root, baseTag);
let messageFile = args.message_file ? path.resolve(args.message_file) : null;
if (!tag || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) throw new Error('provide a safe --tag');
if (!messageFile && args.auto_note) {
  messageFile = path.join(root, '_work/current/publish-notes', tag + '.md');
  ensureDirectory(path.dirname(messageFile));
  fs.writeFileSync(messageFile, [
    '# ' + tag,
    '',
    '## 基于标签',
    args.base_tag || '当前 main',
    '',
    '## 基础内容核验',
    baseVerification.message,
    '',
    '## 本次任务',
    args.task || '项目工作流、skill 或研究任务更新',
    '',
    '## 本次调整',
    args.adjustment || '自动生成的项目变更和可追溯性更新',
    '',
    '## 优化内容',
    args.optimization || '自动提交、测试和状态记录已完成',
    '',
    '## 结果',
    args.result || '已通过项目验证',
    '',
    '## 主要限制',
    args.limitations || '以当前模型、输入和归档状态为准',
    '',
    '## 详细报告',
    args.report || '见项目报告和追溯记录',
    '',
    '## Google Drive',
    args.drive_path || '待写入实际归档路径',
    ''
  ].join('\n'));
}
if (!messageFile || !fs.existsSync(messageFile)) throw new Error('provide an existing --message-file or --auto-note');
const message = fs.readFileSync(messageFile, 'utf8').trim();
for (const section of ['基于标签', '基础内容核验', '本次任务', '本次调整', '优化内容', '结果', '主要限制', 'Google Drive']) if (!message.includes(section)) throw new Error(`message file must contain section: ${section}`);
if (!message.includes(baseVerification.message)) throw new Error(`message file must state exact base verification: ${baseVerification.message}`);
const existingTag = runGit(root, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { allowFailure: true });
if (existingTag.status === 0) throw new Error(`tag already exists: ${tag}; tags are immutable`);
if (baseTag) {
  const base = runGit(root, ['rev-parse', '--verify', `refs/tags/${baseTag}`], { allowFailure: true });
  if (base.status !== 0) throw new Error(`base tag not found: ${baseTag}`);
}
const status = runGit(root, ['status', '--porcelain'], { allowFailure: true });
const dirty = (status.stdout || '').trim();
if (dirty && !args.allow_dirty) throw new Error('working tree has changes; use --allow-dirty only after reviewing them');
const delivery = classifyPaths(root);
const plannedFiles = delivery.candidates;
if (args.push && delivery.excluded.length) throw new Error(`unpublishable files present: ${delivery.excluded.map((item) => item.path + ':' + item.reason).join(', ')}`);
const plan = { tag, base_tag: baseTag, message_file: messageFile, planned_files: plannedFiles, remote: runGit(root, ['remote', 'get-url', 'origin']).stdout.trim(), push: Boolean(args.push), commit_message: args.commit_message || `发布 ${tag}` };
if (!args.push) { console.log(JSON.stringify({ mode: 'dry-run', ...plan, base_verification: baseVerification, delivery }, null, 2)); process.exit(0); }

// Regenerate derived views before publishing.
const node = process.execPath;
const derivedCommands = [
  ['build-variable-catalog-view.mjs', path.join(root, '00_project/traceability/variable-catalog.yaml')],
  ['build-index-views.mjs', root],
  ['build-index-sqlite.mjs', root]
];
for (const [script, argument] of derivedCommands) {
  const command = spawnSync(node, [path.join(import.meta.dirname, script), argument], { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (command.status !== 0) throw new Error(`${script} failed: ${command.stderr || command.stdout}`);
}
const publicationDir = path.join(root, '00_project/traceability/publication-records');
ensureDirectory(publicationDir);
const publicationPath = path.join(publicationDir, `${tag}.json`);
jsonWrite(publicationPath, { publication_id: `PUBLICATION-${tag}`, tag, base_tag: baseTag, base_verification: baseVerification, commit: null, remote: plan.remote, status: 'prepared', message_file: messageFile, prepared_at: nowIso(), pushed_at: null });
runGit(root, ['add', '--', ...delivery.candidates]);
const commitResult = runGit(root, ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', plan.commit_message], { allowFailure: true });
if (commitResult.status !== 0) throw new Error(commitResult.stderr || commitResult.stdout || 'commit failed');
const commit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
runGit(root, ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'tag', '-a', tag, '-F', messageFile]);
runGit(root, ['push', 'origin', 'HEAD:main'], { timeout: 120000 });
runGit(root, ['push', 'origin', `refs/tags/${tag}`], { timeout: 120000 });
const remoteMain = runGit(root, ['ls-remote', 'origin', 'refs/heads/main']).stdout.trim().split(/\s+/)[0];
const remoteTag = runGit(root, ['ls-remote', 'origin', `refs/tags/${tag}^{}`], { allowFailure: true }).stdout.trim();
if (remoteMain !== commit) throw new Error(`remote main does not match ${commit}: ${remoteMain}`);
if (!remoteTag && !runGit(root, ['ls-remote', 'origin', `refs/tags/${tag}`]).stdout.trim()) throw new Error(`remote tag verification failed: ${tag}`);
jsonWrite(publicationPath, { publication_id: `PUBLICATION-${tag}`, tag, base_tag: baseTag, base_verification: baseVerification, commit, remote: plan.remote, remote_main_commit: remoteMain, status: 'published', message_file: messageFile, prepared_at: nowIso(), pushed_at: nowIso() });
runGit(root, ['add', publicationPath]);
runGit(root, ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', `记录 Gitee 发布 ${tag}`]);
runGit(root, ['push', 'origin', 'HEAD:main'], { timeout: 120000 });
console.log(JSON.stringify({ mode: 'published', tag, commit, remote_main_commit: remoteMain, publication: publicationPath }, null, 2));
