# Research Contracts

`contracts/` defines the cross-module research protocol. Templates describe
scientific intent, inputs, observables, validation and permissions; they do not
describe solver steps, Geant4 event-loop details or SolidWorks API calls.

Every dispatched contract is frozen under `07_research_system/control/contracts/instances/<contract_id>/`.
Template files are never mutable task state. A contract change creates a new
instance with `supersedes`, `parent_goal` and `parent_task`.

Generated contract and report instances use pretty-printed JSON in `.yaml`
files. JSON is a strict YAML 1.2 subset and keeps nested arrays lossless with
the project's dependency-free reader.

The three permission sets are mutually exclusive:

- `fixed`: the executor must preserve the value;
- `explorable`: the executor may vary the value only within declared bounds;
- `forbidden`: the executor must not change the object.

Unlisted scientific variables are not authorized for exploration. An executor
that needs a fixed or forbidden change returns a proposal in the unified
`result-issue-report` and waits for Research Workflow to create a new contract.
