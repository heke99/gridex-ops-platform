### Spec Compliance

- ✅ **SPEC compliant; ENOENT ADDRESSED statically** for BASE `d7666c7011f29600fbb08676021d3a793c071d56` → HEAD `921bf395016453a3d68faebdff1a511988af2bd9`. The workflow supplies an explicit absolute path into live HOLD, and the native fixture consumes that path instead of the temporarily absent normal migration path (`.github/workflows/ops-hardening.yml:121–125`; `scripts/ediel-case-view-native.test.ts:28–39,108–112,267–278`).
- ✅ The reader requires an absolute path and exact filename, checks the manifest entry against the pinned original SHA256, then checks the actual raw bytes before decoding or executing them. There is no normal-path fallback, marker acceptance or embedded replacement SQL (`scripts/ediel-case-view-native.test.ts:28–39`; `scripts/migration-history-manifest.json:22,440`).
- ✅ Validation occurs before case mutations and before the post-browser branch; the exported variable is inherited by both native invocations in the same shell step (`scripts/ediel-case-view-native.test.ts:108–115`; `.github/workflows/ops-hardening.yml:124,144–148`).
- ✅ Scope stays within workflow input plumbing, fixture input validation and a short receipt. The supplied full diff leaves migrations, manifest, production code, assertions, cleanup lifecycle, CLI/PG pins, ECR override, generated-contract gates and PR310 unchanged. Prior cap history and user authorization are explicitly retained (`quality/audits/ediel-masterplan-v2/e035-source-ledger/case-original-path-repair-20260923.md:3–9`).
- ⚠️ **Authentic native/browser acceptance remains pending.** The receipt reports isolated boundary, type, lint and workflow checks, not a new PostgreSQL/browser execution (`quality/audits/ediel-masterplan-v2/e035-source-ledger/case-original-path-repair-20260923.md:13–22`). Root must qualify populated replay, bad-owner rejection, protected browser, post-browser invariants and genuine generated artifacts on the published candidate. This review does not reset previous rounds or approve whole E035.

### Strengths

- ✅ The correction follows the real replay lifecycle: original files are copied to HOLD and removed from the normal directory; restoration/removal occurs only at shell EXIT. No lifecycle workaround is introduced (`scripts/gridex-aud-003-clean-replay.sh:28,53–70,104–106`; `.github/workflows/ops-hardening.yml:121–125`).
- ✅ The exact bytes that pass the digest check become the SQL string used by both existing populated-preservation and incompatible-owner assertions, avoiding a second unverified read (`scripts/ediel-case-view-native.test.ts:36–39,111,267–278`).
- ✅ Failure is early and explicit for missing/relative paths, wrong basename, wrong manifest registration and wrong bytes. The reported isolated checks exercise the actual extracted reader and actual workflow export line; reported lint is clean (`scripts/ediel-case-view-native.test.ts:32–38`; `quality/audits/ediel-masterplan-v2/e035-source-ledger/case-original-path-repair-20260923.md:15–20`).

### Issues

#### Critical (Must Fix)

- None identified.

#### Important (Should Fix)

- None identified in this narrow source change.

#### Minor (Nice to Have)

- None identified.

### Assessment

- **Task quality: Approved statically. ENOENT: ADDRESSED.** This fixes the actual missing-file cause while preserving provenance and all SQL/assertion behavior. Authentic execution remains the acceptance gate.
- **Focused lifecycle/inheritance check:** inspected `scripts/gridex-aud-003-clean-replay.sh:28,53–70,104–106` and its final return path. Because the supplied workflow diff cuts off the enclosing run block before both native invocations, inspected `.github/workflows/ops-hardening.yml:123–195` to confirm both execute before the sourced shell's EXIT cleanup, without an intervening unset or replacement of the migration-path variable.
- **Focused manifest/pin check:** inspected `scripts/migration-history-manifest.json:22,440`, `.github/workflows/ops-hardening.yml:91,117`, and existing replay PG pin at `scripts/gridex-aud-003-clean-replay.sh:36`; the reader's manifest shape/checksum match the registered original and the pin/registry configuration remains intact.
- **Review checks:** read supplied brief, report, full diff and approved plan; excluded root dirty documentation from source scope. No tests rerun, no source edits, no git-state mutation, no hosted action; only this requested review report was written.
