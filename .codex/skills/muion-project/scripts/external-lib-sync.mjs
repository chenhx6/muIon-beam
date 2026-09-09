import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, ensureDirectory, relativePath, sha256File, jsonWrite, nowIso, runGit } from './project-utils.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_DRIVE_ROOT = 'H:\\我的云端硬盘\\muIon_archive\\external-libraries';
const EXTERNAL_ROOT = '06_external_lib';
const REGISTRY_FILE = '06_external_lib/library-registry.json';
const MANIFEST_FILE = '06_external_lib/library-manifest.json';
const README_FILE = '06_external_lib/README.md';
const TRACE_DIR = '00_project/traceability/external-libraries';
const OUTBOX_DIR = '00_project/traceability/sync-outbox';
const DRIVE_ONLY_EXTENSIONS = new Set(['.exe', '.dll', '.pyd', '.pyc', '.msi', '.zip']);
const RESERVED_EXTERNAL_FILES = new Set(['README.md', 'library-registry.json', 'library-manifest.json']);

function stableJson(value) { return JSON.stringify(value); }
function digestText(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function writeIfChanged(file, content) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old === content) return false;
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
  return true;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function walkFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result.push(full);
    }
  };
  visit(dir);
  return result.sort((a, b) => a.localeCompare(b));
}
function isDriveOnly(file) { return DRIVE_ONLY_EXTENSIONS.has(path.extname(file).toLowerCase()); }
function libraryIdFromDir(dir) { return path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function registryPath(root) { return path.join(root, REGISTRY_FILE); }
function manifestPath(root) { return path.join(root, MANIFEST_FILE); }

function loadRegistry(root) {
  const file = registryPath(root);
  const registry = readJson(file, { schema_version: '1.0.0', registry_type: 'codex-reference-library', audience: 'codex-internal-reference', execution_policy: 'reference-only', libraries: [] });
  if (!Array.isArray(registry.libraries)) registry.libraries = [];
  return registry;
}

function saveRegistry(root, registry) {
  return writeIfChanged(registryPath(root), `${JSON.stringify(registry, null, 2)}\n`);
}

function scanLibrary(root, dir, metadata) {
  const libraryRoot = path.resolve(dir);
  const files = walkFiles(libraryRoot).map((full) => {
    const rel = relativePath(libraryRoot, full);
    const size = fs.statSync(full).size;
    return { path: rel, size, sha256: sha256File(full), archive: isDriveOnly(rel) ? 'drive-only' : 'gitee' };
  });
  const fingerprintPayload = files.map(({ path: file, size, sha256 }) => ({ path: file, size, sha256 }));
  const contentSha256 = digestText(stableJson(fingerprintPayload));
  const id = metadata?.id || libraryIdFromDir(libraryRoot);
  return {
    id,
    path: relativePath(root, libraryRoot),
    display_name: metadata?.display_name || path.basename(libraryRoot),
    status: metadata?.status || 'active',
    metadata_status: metadata?.metadata_status || 'needs-review',
    role: metadata?.role || 'Codex 内部参考图书馆；待补充来源和功能说明',
    source: metadata?.source || null,
    version: metadata?.version || null,
    license: metadata?.license || null,
    strengths: metadata?.strengths || [],
    limitations: metadata?.limitations || [],
    query_topics: metadata?.query_topics || [],
    adoption: metadata?.adoption || { execution_layer: false, auto_import_to_codex_skills: false, consultation_only: true },
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size, 0),
    gitee_file_count: files.filter((item) => item.archive === 'gitee').length,
    drive_only_file_count: files.filter((item) => item.archive === 'drive-only').length,
    content_sha256: contentSha256,
    files,
  };
}

function makePendingEntry(id, relPath) {
  return {
    id,
    path: relPath,
    display_name: path.basename(relPath),
    status: 'active',
    metadata_status: 'needs-review',
    role: 'Codex 内部参考图书馆；待补充来源和功能说明',
    source: null,
    version: null,
    license: null,
    strengths: [],
    limitations: ['来源、版本和适用范围尚未核实'],
    query_topics: [],
    adoption: { execution_layer: false, auto_import_to_codex_skills: false, consultation_only: true },
  };
}

function discoverLibraries(root, registry) {
  const externalRoot = path.join(root, EXTERNAL_ROOT);
  const registryByPath = new Map(registry.libraries.map((item) => [item.path.replaceAll('\\', '/'), item]));
  const addedRegistry = [];
  const dirs = fs.existsSync(externalRoot)
    ? fs.readdirSync(externalRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(externalRoot, entry.name)).sort()
    : [];
  const records = dirs.map((dir) => {
    const rel = relativePath(root, dir);
    let metadata = registryByPath.get(rel);
    if (!metadata) {
      metadata = makePendingEntry(libraryIdFromDir(dir), rel);
      registry.libraries.push(metadata);
      registryByPath.set(rel, metadata);
      addedRegistry.push(metadata.id);
    }
    return scanLibrary(root, dir, metadata);
  });
  return { records, addedRegistry };
}

function comparePrevious(current, previous) {
  const previousById = new Map((previous?.libraries || []).map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const changes = [];
  for (const item of current) {
    const old = previousById.get(item.id);
    if (!old) changes.push({ type: 'added', library_id: item.id, before: null, after: item.content_sha256 });
    else if (old.content_sha256 !== item.content_sha256) {
      changes.push({ type: 'modified', library_id: item.id, before: old.content_sha256, after: item.content_sha256 });
      const oldFiles = new Map((old.files || []).map((file) => [file.path, file]));
      const currentFiles = new Map(item.files.map((file) => [file.path, file]));
      for (const file of item.files) {
        const prior = oldFiles.get(file.path);
        if (!prior) changes.push({ type: 'file-added', library_id: item.id, path: file.path, after: file.sha256 });
        else if (prior.sha256 !== file.sha256 || prior.size !== file.size) changes.push({ type: 'file-modified', library_id: item.id, path: file.path, before: prior.sha256, after: file.sha256 });
      }
      for (const file of old.files || []) if (!currentFiles.has(file.path)) changes.push({ type: 'file-deleted', library_id: item.id, path: file.path, before: file.sha256, after: null });
    }
    else if (stableJson(old.source) !== stableJson(item.source) || old.version !== item.version || old.license !== item.license || old.metadata_status !== item.metadata_status || old.drive_archive_path !== item.drive_archive_path) changes.push({ type: old.drive_archive_path !== item.drive_archive_path ? 'archive-path-changed' : 'metadata-modified', library_id: item.id, before: old.drive_archive_path !== item.drive_archive_path ? (old.drive_archive_path || null) : (old.metadata_status || null), after: old.drive_archive_path !== item.drive_archive_path ? (item.drive_archive_path || null) : (item.metadata_status || null) });
  }
  for (const old of previous?.libraries || []) if (!currentById.has(old.id) && old.status !== 'retired') changes.push({ type: 'deleted', library_id: old.id, before: old.content_sha256 || null, after: null });
  return changes;
}

function mergeRetired(current, previous, changes, timestamp) {
  const result = [...current];
  const currentIds = new Set(current.map((item) => item.id));
  for (const old of previous?.libraries || []) {
    if (currentIds.has(old.id)) continue;
    if (!changes.some((item) => item.type === 'deleted' && item.library_id === old.id)) continue;
    result.push({ ...old, status: 'retired', retired_at: timestamp });
  }
  return result;
}

function renderReadme(root, manifest) {
  const active = manifest.libraries.filter((item) => item.status !== 'retired');
  const retired = manifest.libraries.filter((item) => item.status === 'retired');
  const lines = [
    '# Codex 内部参考图书馆',
    '',
    '> 本目录供 Codex 查询外部资料、比较设计思路和检索能力边界。它不是用户手册，不是常规执行工具层，也不会自动导入 `.codex/skills` 或执行其中的脚本、安装器和 MCP Server。',
    '',
    `- 清单版本：\`${manifest.schema_version}\``,
    `- 当前活动图书：${active.length}`, 
    '- 机器清单：[`library-manifest.json`](library-manifest.json)',
    '- 元数据登记：[`library-registry.json`](library-registry.json)',
    '',
    '## 当前图书',
    '',
    '| 图书 | 版本 | 来源 | 许可证 | 文件数 | 总大小 | 内容 SHA256 | 状态 |',
    '|---|---|---|---|---:|---:|---|---|',
  ];
  for (const item of active) {
    const source = item.source?.repository || item.source?.url || '待补充';
    const version = item.version || '待补充';
    const license = item.license || '待补充';
    lines.push(`| ${item.display_name} | ${version} | ${source} | ${license} | ${item.file_count} | ${item.total_bytes} B | \`${item.content_sha256}\` | ${item.metadata_status} |`);
  }
  for (const item of active) {
    lines.push('', `### ${item.display_name}`, '', `- 路径：\`${item.path}\``, `- 角色：${item.role}`);
    if (item.strengths?.length) lines.push('- 功能优势：', ...item.strengths.map((value) => `  - ${value}`));
    if (item.limitations?.length) lines.push('- 使用限制：', ...item.limitations.map((value) => `  - ${value}`));
    if (item.query_topics?.length) lines.push('- 适合查询：', ...item.query_topics.map((value) => `  - ${value}`));
    if (item.source) lines.push(`- 来源仓库：${item.source.repository || item.source.url || '待补充'}`, `- 来源版本：${item.source.release || item.version || '待补充'}`, `- 来源 commit：\`${item.source.commit || '待补充'}\``);
    lines.push('- 执行边界：仅供 Codex 参考；项目实际执行仍以本仓库已验证的技能、模型、环境和门禁为准。');
  }
  if (retired.length) {
    lines.push('', '## 已退休图书', '', '以下条目已从工作区移除，但其历史 Gitee/Drive 归档保留，不自动清理。', '', '| 图书 | 原内容 SHA256 | 退休时间 |', '|---|---|---|');
    for (const item of retired) lines.push(`| ${item.display_name} | \`${item.content_sha256 || ''}\` | ${item.retired_at || ''} |`);
  }
  lines.push('', '## 三端保存策略', '', '- Gitee：目录、来源/许可证、机器清单、源码、脚本、示例和参考文档。', '- Google Drive：完整便携库和所有 Drive-only 二进制，按内容指纹建立不可变版本。', '- 变更触发：task:begin、auto:commit-push、task:close、sync-project。', '- 删除策略：记录 retired/tombstone，保留历史归档，不自动删除唯一原始内容。', '');
  return `${lines.join('\n')}\n`;
}

function manifestFor(records, previous, changes, timestamp) {
  return {
    schema_version: '1.0.0',
    manifest_type: 'external-reference-library',
    audience: 'codex-internal-reference',
    execution_policy: 'reference-only',
    generated_at: timestamp,
    last_changed_at: changes.length ? timestamp : (previous?.last_changed_at || timestamp),
    changes,
    libraries: mergeRetired(records, previous, changes, timestamp),
  };
}

function archiveDirectory(sourceDir, targetDir, files) {
  ensureDirectory(targetDir);
  for (const record of files) {
    const source = path.join(sourceDir, record.path);
    const target = path.join(targetDir, record.path);
    ensureDirectory(path.dirname(target));
    if (fs.existsSync(target)) {
      if (fs.statSync(target).size !== record.size || sha256File(target) !== record.sha256) throw new Error(`existing Drive file differs: ${record.path}`);
    } else fs.copyFileSync(source, target);
    if (fs.statSync(target).size !== record.size || sha256File(target) !== record.sha256) throw new Error(`Drive SHA256 mismatch: ${record.path}`);
  }
  const archiveManifest = { schema_version: '1.0.0', manifest_type: 'external-library-archive', source_path: relativePath(process.cwd(), sourceDir), content_sha256: digestText(stableJson(files.map(({ path: file, size, sha256 }) => ({ path: file, size, sha256 })))), file_count: files.length, total_bytes: files.reduce((sum, item) => sum + item.size, 0), files };
  jsonWrite(path.join(targetDir, 'archive-manifest.json'), archiveManifest);
  return archiveManifest;
}

function gitEligiblePaths(root) {
  const paths = [];
  const externalRoot = path.join(root, EXTERNAL_ROOT);
  for (const full of walkFiles(externalRoot)) {
    if (isDriveOnly(full)) continue;
    paths.push(relativePath(root, full));
  }
  return paths;
}

function publishGitee(root, paths, message) {
  if (!paths.length) return { status: 'nothing-to-publish', commit: null };
  runGit(root, ['add', '--', ...paths]);
  const commit = runGit(root, ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', message], { allowFailure: true });
  if (commit.status !== 0) {
    if (/nothing to commit/i.test(`${commit.stdout || ''}${commit.stderr || ''}`)) return { status: 'nothing-to-publish', commit: null };
    throw new Error(commit.stderr || commit.stdout || 'Gitee commit failed');
  }
  const hash = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  const push = runGit(root, ['push', 'origin', 'HEAD:main'], { allowFailure: true, timeout: 120000 });
  if (push.status !== 0) throw new Error(push.stderr || push.stdout || 'Gitee push failed');
  const remote = runGit(root, ['ls-remote', 'origin', 'refs/heads/main'], { allowFailure: true }).stdout.trim().split(/\s+/)[0] || null;
  if (remote !== hash) throw new Error(`Gitee remote main does not match ${hash}: ${remote}`);
  return { status: 'published', commit: hash, remote };
}

function writeState(root, state) {
  const file = path.join(root, TRACE_DIR, `${state.sync_id}.json`);
  jsonWrite(file, state);
  if (state.status !== 'three-way-verified') jsonWrite(path.join(root, OUTBOX_DIR, `${state.sync_id}.json`), state);
  else {
    const outbox = path.join(root, OUTBOX_DIR, `${state.sync_id}.json`);
    if (fs.existsSync(outbox)) fs.rmSync(outbox, { force: true });
  }
  return file;
}

export function syncExternalLibraries(options = {}) {
  const root = path.resolve(options.projectRoot || projectRootFromHere());
  const event = options.event || 'manual';
  const checkOnly = Boolean(options.checkOnly);
  const publish = options.publish !== false && !checkOnly;
  const timestamp = nowIso();
  if (!fs.existsSync(path.join(root, EXTERNAL_ROOT))) return { status: 'unchanged', event, changed: false, changes: [], libraries: [] };
  const driveRoot = options.driveRoot || process.env.MUION_EXTERNAL_LIB_DRIVE_ROOT || DEFAULT_DRIVE_ROOT;
  const registry = loadRegistry(root);
  const discovery = discoverLibraries(root, registry);
  for (const item of discovery.records) item.drive_archive_path = path.join(driveRoot, item.id, item.content_sha256);
  const previous = readJson(manifestPath(root), null);
  const changes = comparePrevious(discovery.records, previous);
  const manifest = manifestFor(discovery.records, previous, changes, timestamp);
  const changed = changes.length > 0 || discovery.addedRegistry.length > 0 || !fs.existsSync(manifestPath(root)) || !fs.existsSync(path.join(root, README_FILE));
  if (checkOnly) {
    return { status: 'checked', event, changed, changes, added_registry: discovery.addedRegistry, libraries: manifest.libraries.map((item) => ({ id: item.id, status: item.status, file_count: item.file_count, total_bytes: item.total_bytes, content_sha256: item.content_sha256 })) };
  }
  if (discovery.addedRegistry.length) saveRegistry(root, registry);
  const driveResults = [];
  let driveError = null;
  try {
    for (const item of discovery.records) {
      const target = path.join(driveRoot, item.id, item.content_sha256);
      item.drive_archive_path = target;
      const archive = archiveDirectory(path.join(root, item.path), target, item.files);
      driveResults.push({ library_id: item.id, path: target, status: 'verified', file_count: archive.file_count, total_bytes: archive.total_bytes, content_sha256: archive.content_sha256 });
    }
  } catch (error) {
    driveError = error;
    for (const item of discovery.records) driveResults.push({ library_id: item.id, path: path.join(driveRoot, item.id, item.content_sha256), status: 'pending-drive' });
  }
  if (changed) {
    writeIfChanged(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
    writeIfChanged(path.join(root, README_FILE), renderReadme(root, manifest));
  }
  if (!changed && discovery.addedRegistry.length === 0) {
    return { status: 'unchanged', event, changed: false, changes: [], libraries: manifest.libraries.map((item) => ({ id: item.id, status: item.status, file_count: item.file_count, total_bytes: item.total_bytes, content_sha256: item.content_sha256 })) };
  }
  const syncId = `SYNC-EXTERNAL-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${digestText(stableJson(changes)).slice(0, 8)}`;
  const state = { sync_id: syncId, manifest_type: 'external-library-sync-state', schema_version: '1.0.0', created_at: timestamp, event, status: driveError ? 'pending-drive' : 'pending-gitee', changes, drive_root: driveRoot, drive: driveResults, gitee: { status: 'pending', commit: null }, manifest_path: MANIFEST_FILE, readme_path: README_FILE, errors: driveError ? [driveError.message] : [] };
  if (!driveError && publish && changed) {
    try {
      const gitee = publishGitee(root, gitEligiblePaths(root), `登记 Codex 外部参考图书馆 ${timestamp.slice(0, 10)}`);
      state.gitee = gitee;
      state.status = 'three-way-verified';
    } catch (error) {
      state.errors.push(error.message);
      state.status = 'pending-gitee';
    }
  } else if (!driveError && !changed) {
    state.gitee = { status: 'unchanged', commit: null };
    state.status = 'unchanged';
  } else if (!driveError && !publish) {
    state.gitee = { status: 'not-requested', commit: null };
    state.status = 'pending-gitee';
  }
  const statePath = writeState(root, state);
  if (state.status === 'three-way-verified' && state.gitee.commit) {
    // Record the verified Gitee commit after the content commit. This state file is
    // deliberately separate so the content commit remains path-scoped.
    state.state_path = relativePath(root, statePath);
    jsonWrite(statePath, state);
    const stateCommit = publishGitee(root, [relativePath(root, statePath)], `记录外部参考图书馆同步 ${timestamp.slice(0, 10)}`);
    state.gitee.state_commit = stateCommit.commit;
  }
  if (driveError) {
    const result = { ...state, state_path: relativePath(root, statePath), changed, added_registry: discovery.addedRegistry };
    if (!options.allowPending) { const error = new Error(`external library Drive sync pending: ${driveError.message}`); error.result = result; throw error; }
    return result;
  }
  return { ...state, state_path: relativePath(root, statePath), changed, added_registry: discovery.addedRegistry };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.project_root || projectRootFromHere());
  const result = syncExternalLibraries({
    projectRoot: root,
    event: args.event || 'manual',
    checkOnly: Boolean(args.check),
    publish: !args.no_publish,
    driveRoot: args.drive_root || undefined,
    allowPending: Boolean(args.allow_pending),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'pending-drive' || result.status === 'pending-gitee') process.exitCode = 2;
}

if (path.resolve(process.argv[1] || '') === path.resolve(SCRIPT_FILE)) main();
