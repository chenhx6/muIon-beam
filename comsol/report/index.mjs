import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function id() { return `COMSOL-RESULT-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`; }

export function buildComsolResult({ task, adapter, build, baseline, cases = [], validation, findings = [], warnings = [], issues = [], escalations = [], scope_expansion_requests = [], exploration_history = [], stopping_reason = '', execution_record = {}, next_interface_requests = [] } = {}) {
  const result = {
    schema_version: '0.1.0',
    result_id: id(),
    task_id: task.task_id,
    status: 'partial',
    adapter: { kind: adapter?.kind || 'unknown', version: adapter?.version || null, available: Boolean(adapter?.available), capabilities: adapter?.capabilities || {}, unavailable_reason: adapter?.unavailable_reason || null, runtime: adapter?.runtime || null },
    build,
    baseline,
    cases,
    validation,
    findings,
    warnings,
    issues,
    escalations,
    scope_expansion_requests,
    assumptions: task.assumptions,
    exploration_history,
    stopping_reason,
    next_interface_requests,
    execution_record
  };
  if (!result.adapter.available) result.status = 'blocked';
  else if (validation?.success_criteria?.some((v) => v.value === true || v.passed === true) && !escalations.length) result.status = 'complete';
  else if (cases.some((c) => c.status === 'failed') && !findings.some((f) => f.kind === 'physical')) result.status = 'failed';
  else result.status = 'partial';
  return result;
}

export function renderMarkdownReport(result) {
  const lines = [
    `# COMSOL Block result ${result.result_id}`,
    '',
    `- Task: ${result.task_id}`,
    `- Status: ${result.status}`,
    `- Adapter: ${result.adapter.kind} (available=${result.adapter.available})`,
    '',
    '## What was calculated',
    result.baseline?.case_id ? `Baseline case \`${result.baseline.case_id}\` plus ${Math.max(0, result.cases.length - 1)} follow-up case(s).` : 'No numerical case was executed.',
    '',
    '## Validation',
    `- Calculation finished: ${String(result.validation?.calculation_finished ?? false)}`,
    `- Validation status: ${result.validation?.validation_status || 'not-evaluated'}`,
    `- Solver convergence: ${JSON.stringify(result.validation?.solver_convergence || 'not-evaluated')}`,
    '',
    '## Findings and interfaces',
    ...(result.findings || []).map((f) => `- ${f.kind}: ${f.statement}`),
    ...(result.warnings || []).map((w) => `- Warning: ${w.message}`),
    ...(result.issues || []).map((i) => `- Issue: ${i.title} — ${i.observation}`),
    ...(result.escalations || []).map((e) => `- Escalation: ${e.observation}`),
    ...(result.scope_expansion_requests || []).map((s) => `- Scope expansion request: ${s.variable}`),
    '',
    '## Assumptions',
    ...(result.assumptions || []).map((a) => `- ${a.id}: ${a.statement} (${a.status})`),
    '',
    `## Stopping reason\n${result.stopping_reason || 'not recorded'}`,
    '',
    '## Next interface requests',
    ...(result.next_interface_requests || []).map((r) => `- ${r.type || 'request'}: ${r.title || r.observation || r.reason || JSON.stringify(r)}`)
  ];
  return `${lines.join('\n')}\n`;
}

export function renderSummaryReport(result) {
  const physical = (result.findings || []).filter((f) => f.kind === 'physical').map((f) => f.statement);
  const interfaces = [...(result.issues || []), ...(result.escalations || []), ...(result.scope_expansion_requests || [])];
  return [
    '# COMSOL Block 简洁报告',
    '',
    `- 任务：${result.task_id}`,
    `- 状态：${result.status}`,
    `- 计算适配器：${result.adapter.kind}（可用=${result.adapter.available}）`,
    `- Case：${result.cases.length}（baseline=${result.baseline?.case_id || '未执行'}）`,
    `- 验证状态：${result.validation?.validation_status || '未评估'}`,
    '',
    '## 主要发现',
    ...(physical.length ? physical.map((v) => `- ${v}`) : ['- 未记录物理失败发现。']),
    '',
    '## 停止原因',
    result.stopping_reason || '未记录',
    '',
    '## 接口请求',
    ...(interfaces.length ? interfaces.map((v) => `- ${v.type || 'Request'}：${v.title || v.observation || v.variable || v.reason || '未命名请求'}`) : ['- 无'])
  ].join('\n') + '\n';
}

export function renderDetailedReport(result) {
  return [
    renderMarkdownReport(result).trimEnd(),
    '',
    '## Exploration history',
    '```json',
    JSON.stringify(result.exploration_history || [], null, 2),
    '```',
    '',
    '## Case result data',
    '```json',
    JSON.stringify(result.cases || [], null, 2),
    '```',
    '',
    '## Diagnosis data',
    '```json',
    JSON.stringify(result.diagnostics || [], null, 2),
    '```'
  ].join('\n') + '\n';
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function writeResultBundle(result, { directory, overwrite = false } = {}) {
  if (!directory) throw new Error('writeResultBundle requires directory');
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  const files = {
    'comsol-result.json': JSON.stringify(result, null, 2) + '\n',
    'summary-report-zh.md': renderSummaryReport(result),
    'detailed-report-zh.md': renderDetailedReport(result)
  };
  const manifestPath = path.join(root, 'comsol-result-manifest.json');
  if (!overwrite) {
    const existing = [...Object.keys(files).map((name) => path.join(root, name)), manifestPath].find((target) => fs.existsSync(target));
    if (existing) throw new Error(`Refusing to overwrite existing COMSOL result artifact: ${existing}`);
  }
  for (const name of Object.keys(files)) {
    const target = path.join(root, name);
    fs.writeFileSync(target, files[name]);
  }
  const records = Object.keys(files).map((name) => ({ path: name, sha256: sha256(path.join(root, name)), size: fs.statSync(path.join(root, name)).size, role: name.endsWith('.json') ? 'result-data' : 'report' }));
  const manifest = { manifest_type: 'comsol-result', schema_version: '0.1.0', manifest_id: result.result_id, task_id: result.task_id, status: result.status, parent_traceability: result.traceability || null, files: records };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { directory: root, manifest: 'comsol-result-manifest.json', files: records };
}
