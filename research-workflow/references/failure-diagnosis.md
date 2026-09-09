# Failure diagnosis

Classify issues as infrastructure, contract, geometry, numerical,
physics-model, statistics, cross-module or unknown. Infrastructure may receive
one bounded retry with the same immutable contract. Numerical recovery remains
inside the module. Contract, geometry, physics-model and cross-module changes
require a proposal or a new routed contract. Repeated failure without new
information stops exploration.
