# COMSOL adapter boundary

The repository currently has a verified COMSOL 6.4 Batch executable at
`C:\\Program Files\\COMSOL\\COMSOL64\\Multiphysics\\bin\\win64\\comsolbatch.exe`
and the existing project contains Java API sources under
`02_models/comsol/legacy-scripts`. A runtime being installed is not the same as
an adapter being verified for this Block.

`batch.mjs` provides a small command adapter for an explicit command template.
The template must accept a task/case JSON and write a result JSON; the adapter
does not guess which historical Java class or MPH model to run. This keeps
legacy assets read-only and makes the first real test reproducible.

Example (Node.js):

```js
import { createComsolBatchAdapter } from './comsol/adapters/batch.mjs';
const adapter = createComsolBatchAdapter({
  executable: 'C:\\Program Files\\COMSOL\\COMSOL64\\Multiphysics\\bin\\win64\\comsolbatch.exe',
  build_command_template: '{executable} -np 1 -inputfile {task} -outputfile {result}',
  command_template: '{executable} -np 1 -inputfile {task} -outputfile {result}'
});
```

The placeholders are shell-quoted by the adapter, so do not add another pair
of quotes around them. `build_command_template` is required when the task
creates or modifies a model; omit it only when `inputs.previous_model` is an
explicit, already-built model. Use a unique temporary directory/prefs
directory for each real run, and provide an explicit model/Java entrypoint in
the task or adapter configuration.
