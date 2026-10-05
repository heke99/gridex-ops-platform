### Spec Compliance

- ✅ Spec compliant: `.github/workflows/ops-hardening.yml:116-119` adds only the step-level `SUPABASE_INTERNAL_IMAGE_REGISTRY: public.ecr.aws` setting to the clean replay/typegen step. The pinned CLI's registry mapping supports that value, and `quality/audits/ediel-masterplan-v2/e035-source-ledger/registry-recovery-20260923.md:3-9` records the GHCR failure, official source rationale, local validation, and pending native CI qualification.
- ⚠️ Cannot verify from diff: the cited native job failures, the unchanged CLI/PostgreSQL pins and complete downstream command coverage lie outside the changed hunks (`quality/audits/ediel-masterplan-v2/e035-source-ledger/registry-recovery-20260923.md:3-9`). The preflight records the failures as a parent report; the controller should retain its job-log evidence and require ordinary CI to prove the ECR pull and all native gates.

### Strengths

- `.github/workflows/ops-hardening.yml:116-119`: the environment override is confined to the one shell step, with no commands or assertions removed.
- `quality/audits/ediel-masterplan-v2/e035-source-ledger/registry-recovery-20260923.md:5-9`: the receipt distinguishes tag-preserving registry selection from unproven digest equality or image availability, and explicitly withholds native acceptance.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

None.

### Assessment

**Task quality:** Approved

**Reasoning:** The two-line workflow change is the narrow supported override requested. Official setup-action source exports GHCR for this CLI version, while the pinned CLI source defaults to `public.ecr.aws` and maps the same final image names/tags there; the reported YAML structural comparison and `git diff --check` passed without test-output warnings. Actual registry availability and native qualification remain CI gates.
