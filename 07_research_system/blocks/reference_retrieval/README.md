# Reference Retrieval Adapter

This block provides the project-owned interface for local-first reference
search and task-triggered external retrieval. It must query the local
`08_references` full-text index before using an external crawler.

External implementations are optional adapters. Candidate source code is kept
outside the active project until its commit, license, dependencies, and smoke
tests are recorded under `00_project/traceability/evolution`.

The shell environment currently cannot reach GitHub for clone operations. The
adapter therefore records the blocked retrieval state rather than silently
falling back to untracked downloads.
