# Decision Log

- Active project IDs use lowercase `snake_case`; historical uppercase IDs are
  not active aliases.
- Timestamped artifact names use `YYYYMMDD_HHMM` followed by `-` fields.
- `09_catalog` is an index and navigation layer, not a duplicate data store.
- `10_plans/inbox` accepts user ideas and unclassified requests.
- Reference search checks the local full-text library before external retrieval.
- External retrieval is task-triggered and provenance-recorded.
- `90_migration` deletion is deferred to a separate controlled task.
