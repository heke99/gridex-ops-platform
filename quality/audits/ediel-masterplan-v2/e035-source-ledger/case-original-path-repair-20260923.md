# User-authorized case replay original-path repair

Status: local bounded checks PASS; authentic replay/browser remains pending. Task base `d7666c7011f29600fbb08676021d3a793c071d56`. The user explicitly authorized continuation after the reported five-round stop; this receipt preserves that history and does not reset the budget or claim whole-E035 acceptance.

Actual controller evidence: native107324705734 on published bf6d4b5 applied the event restoration migration, retained124 PASS, and reached case-native line253 after preceding Support/platform/tenant/rollback/grant assertions. It then failed ENOENT before populated-legacy rerun, browser, post-browser and generated artifacts. `source scripts/gridex-aud-003-clean-replay.sh` copies originals into its absolute temporary HOLD, removes SQL from the normal migration directory, and restores originals only in its shell EXIT trap. The native test incorrectly read the normal path while that sourced lifecycle was still active.

The workflow now exports `GRIDEX_EDIEL_CASE_RESTORATION_SQL` from the live HOLD immediately after sourcing replay and checks the file exists. The same exported variable remains available to both native case invocations. At native test entry, before any case mutations or the post-browser branch, the actual reader requires an absolute path, exact original basename, manifest registration matching the pinned SHA256 `290357346253461628c6d341ba383d16690b62613dc8ce913eb3044965cd59a8`, and raw file bytes matching that checksum. Only then is the verified text supplied to the unchanged populated-row preservation and bad-owner rejection SQL checks. There is no normal-path fallback, embedded SQL replacement, marker acceptance, or premature cleanup.

Scope is workflow/test input plumbing only. All existing case/browser/post-browser assertions remain. Published migration/manifest/production bytes, replay lifecycle, pinned CLI2.101.0/PG17, reviewed ECR override, generated-contract gates, RLS and ownership checks remain unchanged. No hosted write, market send, PR310 edit or push. Root owns shared memory, independent review, publication and authentic generated artifacts.

Applied the already-read systematic-debugging, test-driven-development/writing-good-tests and verification-before-completion guidance to this bounded fixture defect. No database/UI/product implementation or full-suite rerun was needed.

Executed verification using Node22 `/root/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`:

- Isolated RED reproduced ENOENT by executing the original native read expression with the normal migration path absent and the genuine original present in temporary HOLD.
- Isolated GREEN executed the actual updated TypeScript reader (AST extracted and transpiled, not a reimplementation) against real temporary files: 7 cases PASS covering held original, missing env, relative path, wrong basename, absent file, marker bytes/hash mismatch and wrong manifest registration. Scratch harness `/tmp/e035-case-path-boundary-check.cjs`; no SQL was executed.
- Parsed workflow YAML via installed js-yaml, extracted the exact replay run block, and ran `bash -n`: PASS. Executed the actual export line with temporary HOLD and confirmed two child invocations inherited the absolute original-file path: PASS.
- `tsc --noEmit -p tsconfig.scripts.json`: PASS.
- ESLint on `scripts/ediel-case-view-native.test.ts`: PASS, zero warnings/errors.
- `git diff --check`: PASS.

Native PostgreSQL, protected browser, post-browser and authentic generated artifacts have not been rerun locally (no Docker/psql). Next gate is independent bounded review and root publication for the ordinary authentic replay. No final acceptance follows from these local input-boundary checks.
