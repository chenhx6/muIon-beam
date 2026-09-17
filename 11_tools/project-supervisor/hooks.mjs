import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalRoot } from './runtime-store.mjs';
import { ensureDaemon } from './index.mjs';
import { ProjectSupervisor } from './project-supervisor.mjs';

export async function handleHook(event, { root = canonicalRoot(event.cwd), supervisor = new ProjectSupervisor(root), ensure = ensureDaemon } = {}) {
  if (!['SessionStart', 'UserPromptSubmit'].includes(event.hook_event_name)) throw new Error('unsupported supervisor hook event');
  await ensure(root);
  const entry = await supervisor.enter({ sessionId: event.session_id, source: event.hook_event_name });
  const serviceText = Object.entries(entry.services).map(([name, state]) => `${name}: ${state.status}`).join('; ');
  const sessionText = entry.session ? `Session ${entry.session.session_id}, status ${entry.session.status}, mode ${entry.session.mode}. All task writes must use this working directory: ${entry.session.worktree_path}. If status is not active, preserve the worktree and resolve the recorded integration/blocker before any further edit. Keep the host session and model unchanged. ` : 'No writer was allocated; enter with a stable session identity before editing. ';
  const content = `muIon-beam automatic entry: ${serviceText}. ${sessionText}Read AGENTS.md and the active ADR context below. Do not run evolution unless the user explicitly invokes it.\n` + entry.context.map(item => `--- ${item.path} ---\n${item.content}`).join('\n');
  return { ...(entry.ready ? {} : { systemMessage: `Project services need recovery: ${serviceText}. Inspect supervisor status; do not claim full automation healthy.` }), hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: content } };
}
async function main() {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw new Error('hook input too large'); }
  const event = JSON.parse(input); return handleHook(event);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(value => console.log(JSON.stringify(value))).catch(error => {
  console.log(JSON.stringify({ systemMessage: `muIon-beam bootstrap failed: ${error.message}. Follow AGENTS.md automatic-entry recovery before editing.` })); process.exitCode = 1;
});
