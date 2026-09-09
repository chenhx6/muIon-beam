# Geant4 workflow and stopping rules

The block has a short, repeatable execution path. Preflight records the actual
toolchain and Geant4 installation. Sanity checks confirm that the referenced
geometry, source, material, process list, field and output scorers are present.
The native smoke is deliberately small. A baseline task run follows only after
the smoke or an explicitly supplied verified baseline has completed.

Diagnosis separates three cases:

1. a local execution or numerical problem, such as a missing process, invalid
   field setup, bad geometry navigation or an unusable step limit;
2. a statistical problem, where a stated observable needs more events or a
   convergence comparison;
3. a physical reachability or upstream problem, where changing a Geant4-local
   setting would conceal an external cause.

Only the first two may be repaired inside this block. For the third case, stop
after the smallest informative probe and return an IssueReport. A parameter
scan is allowed only when its variables are local, its cases are explicit or
task-authorized, and the previous result gives information gain. Repeating the
same failure mechanism without information gain is a valid stopping result.
