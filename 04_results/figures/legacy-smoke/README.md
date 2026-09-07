# Nature figure integration smoke test

This small single-panel figure uses the migrated historical cooling table and the pinned Python `nature-figure` backend. It verifies the local plotting runtime and export path; it is not a new scientific result.

The source preflight passed with no failures; the PDF text audit found a 6 pt minimum glyph and no glyph below 5 pt; the rendered collision audit returned `PASS`. The source data and script remain in the project so the check can be repeated.
