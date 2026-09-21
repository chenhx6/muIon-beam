import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { applyIntegration, checkSession, planIntegration, readSession, submitSession } from '../../.codex/skills/team/scripts/session-concurrency.mjs';

const statusPaths = root => {
  return spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true }).stdout.split(/\r?\n/).filter(Boolean);
};

export function prepareIntegration({ root, sessionId }) {
  const session = readSession(root, sessionId);
  const checked = checkSession({ root, sessionId });
  if (checked.status !== 'ready') return { status: 'blocked-ownership', session_id: sessionId, outside_claim_paths: checked.outside_claim_paths };
  if (session.mode !== 'worktree' || !session.branch) return { status: 'blocked-mode', session_id: sessionId, mode: session.mode };
  if (session.status === 'active') {
    try { submitSession({ root, sessionId }); }
    catch (error) { return { status: 'blocked-submit', session_id: sessionId, reason: error.message }; }
  }
  return { status: 'ready-for-integration', session_id: sessionId, receipt: planIntegration({ root, sessionId }) };
}

export function integratePrepared({ root, sessionId }) {
  if (statusPaths(root).length) return { status: 'blocked-dirty-leader', session_id: sessionId, next_action: 'preserve leader changes and retry after a clean integration checkout' };
  const prepared = prepareIntegration({ root, sessionId });
  if (prepared.status !== 'ready-for-integration') return prepared;
  const result = applyIntegration({ root, sessionId });
  return { ...result, session_id: sessionId, source_branch: readSession(root, sessionId).branch };
}
