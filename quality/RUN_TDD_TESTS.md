# TDD Verification Protocol: Gridex OPS remediation

## Per-bug cycle

For each confirmed BUG-NNN, confirm the regression test calls the cited function/path and asserts desired behavior. Remove test.fails temporarily and run the focused test against unpatched source: it must fail for the cited reason. Re-enable the guard, apply the matching quality/patches/BUG-NNN-fix.patch or implement the reviewed fix, remove the guard and rerun: it must pass. Then run neighboring tests and the appropriate contract/database gate.

## Result schema

Record quality/results/tdd-results.json with schema_version 1.1 and one item per bug: bug_id, test_file, test_name, patch_path, red_phase (fail), green_phase (pass or skipped), verdict (fixed or confirmed open), evidence and writeup_path. Do not use a skipped verdict. Reopen the JSON after writing and reject unknown root keys or invalid enums.

## Closure

Every successful red-to-green cycle gets quality/writeups/BUG-NNN.md containing symptom, root cause, invariant, reproducer, fix, regression coverage, live/migration impact and verification commands. An open confirmed bug blocks final closure; an external production-evidence gap is not mislabeled as a code bug.
