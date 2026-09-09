# Cross-module IssueReport

When a result may be owned outside Geant4, return a structured record rather
than editing the upstream input:

```yaml
category: geometry | comsol-field | source-upstream | device-configuration | research-assumption
observation: "what was observed"
evidence: []
candidate_explanations: []
suggested_next_checks: []
confidence: preliminary
owner: research-workflow
```

The evidence should include run identifiers, output paths and the exact local
settings that were held fixed. The block can suggest checks, but Research
Workflow decides whether to route a geometry, COMSOL, source or objective
change.
