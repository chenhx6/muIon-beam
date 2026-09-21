# ProjectSupervisor contracts

ProjectSupervisor composes independently testable modules. It does not choose physics, change the model, run evolution or publish scientific results.

| Component | Input / operation | Owned state | Failure behaviour |
| --- | --- | --- | --- |
| ProjectSupervisor | enter(session_id, source), ensure | session entry events | reports service readiness; leaves scientific state unchanged |
| ProcessSupervisor | adapters with health/start methods | processes.json, process-health events | restarts exited services; reports unknown listeners or unresponsive live processes without killing them |
| FarmerService | ensure existing farmer, check PID + heartbeat | farmer owns its runtime; adapter reads it | farmer resumes only allowlisted transient session failures |
| DashboardService | ensure localhost listener, check identity + status endpoint | dashboard process log | foreign port owner remains untouched and visible as blocked |
| ProjectContext | active ADR index + requested scopes | no mutable state | missing/invalid active files cause entry failure |
| RuntimeStore | atomic records, async interprocess lock, append events | _work/current/project-supervisor | avoids concurrent starts; corrupt state fails visibly |
| SessionBootstrapper | host identity, intent, claims | existing concurrency registry | private worktree before writes; resume preserves branch and files |
| WorkerRuntime | farmer host state, session registry | worker health view | renew running leases; report ownership violations and retain files |
| ArtifactCatalog | untracked and ignored worktree files | artifact triage records | record SHA256 and next action without deleting output |
| ArtifactPromoter | explicit artifact plan and approved target | promotion receipt | copy-only, hash-checked promotion; binary/unknown output stays blocked |
| IntegrationCoordinator | submitted worker receipt + clean leader | integration receipt | serialize merge, preserve conflict worktree, block dirty leader |
| ArtifactPromoter / ProgressAggregator (P3) | output inventory, branch facts | manifests / derived views | unregistered outputs remain visible and retained |
| SyncCoordinator (P4) | validated delivery and archive contracts | sync receipts, recovery index | pending recovery remains explicit; no false success |

The scientific authority remains `07_research_system/control/research-state/state.yaml`. Service health is infrastructure state, not another scientific status source. ProjectContext loads AGENTS and active ADRs but never rewrites them. Runtime logs contain health and lifecycle metadata, not user prompts, credentials or transcripts.

`index.mjs enter` is called automatically by the agent at task entry. `ensure` starts a detached, hidden Node supervisor that checks farmer and dashboard every five seconds; `status` is read-only, and `stop` requests only the supervisor loop to exit. Healthy service processes are reused. The daemon never independently publishes or runs solvers.

The repo-local `.codex/hooks.json` connects SessionStart (including resume/compact) and UserPromptSubmit to `hooks.mjs`. Hooks receive structured input on stdin and return project context. Local CLI inspection on 2026-09-17 reported `hooks stable true`. Host trust remains an independent prerequisite: a new or changed hook can be skipped until trusted. The AGENTS entry route remains available in Desktop and CLI and requires no user script invocation. A direct handler test is not proof of host delivery; live hook receipts are recorded separately from agent-entry receipts.

Source: [official Codex hooks](https://learn.chatgpt.com/docs/hooks). No hook-trust bypass, managed-policy injection or trust database writes are part of this implementation.
