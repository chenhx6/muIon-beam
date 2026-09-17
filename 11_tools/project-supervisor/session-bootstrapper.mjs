import crypto from 'node:crypto';
import { beginSession, listSessions, heartbeatSession, closeSession } from '../../.codex/skills/team/scripts/session-concurrency.mjs';

export class SessionBootstrapper {
  constructor(root, store) { this.root = root; this.store = store; }
  async enter({ sessionId, intent = 'write', ownedPaths = [] }) {
    if (!sessionId || typeof sessionId !== 'string') throw new Error('session identity is required before allocating a writer');
    if (!['read', 'write'].includes(intent)) throw new Error('unknown session intent');
    return this.store.exclusive('session-bindings', async () => {
      const sessions = listSessions({ root: this.root }).filter(item => item.host_session_id === sessionId);
      let existing = sessions.filter(item => !['closed', 'abandoned'].includes(item.status)).at(-1);
      if (existing?.mode === 'shared-read' && intent === 'write') {
        closeSession({ root: this.root, sessionId: existing.session_id, token: existing.owner_token }); existing = null;
      }
      if (existing) {
        if (existing.status === 'active') heartbeatSession({ root: this.root, sessionId: existing.session_id, token: existing.owner_token });
        return this.context(existing);
      }
      const suffix = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 20);
      const localId = `codex-${suffix}-${sessions.length + 1}`;
      const session = beginSession({ root: this.root, sessionId: localId, hostSessionId: sessionId, mode: intent === 'read' ? 'shared-read' : 'worktree', ownedPaths, isolatedOverlap: intent === 'write' && !ownedPaths.length });
      this.store.event('session-provisioned', { session_id: session.session_id, host_session_id: sessionId, mode: session.mode, worktree: session.worktree_path });
      return this.context(session);
    });
  }
  context(session) {
    return { session_id: session.session_id, host_session_id: session.host_session_id, mode: session.mode, status: session.status, worktree_path: session.worktree_path, branch: session.branch, claims: session.claims, isolated_overlap: session.isolated_overlap };
  }
}
