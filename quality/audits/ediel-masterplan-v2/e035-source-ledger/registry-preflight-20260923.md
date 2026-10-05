# Disposable replay registry preflight — 2026-09-23

Read-only implementation preflight; only this receipt was written. No workflow, case code, migration, hosted service, or image version changed.

## Evidence

- Parent reports native jobs 107318534277, 107320203307 and 107321599880 failed with GHCR `toomanyrequests` before database startup. These results do not qualify or disqualify the pending native case implementation.
- `.github/workflows/ops-hardening.yml` pins `supabase/setup-cli@v1` to CLI `2.101.0`; no explicit image registry override exists. The same shell step runs clean replay, native checks and type generation.
- Official setup action source, `https://raw.githubusercontent.com/supabase/setup-cli/v1/src/main.ts`, exports `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io` for CLI versions at least 1.28.0. Retrieved 2026-09-23. The action reference is a moving v1 reference, matching the workflow.
- Official pinned CLI source is under the reorganized path: `https://raw.githubusercontent.com/supabase/cli/v2.101.0/apps/cli-go/internal/utils/docker.go` (the old `internal/utils/docker.go` URL returns 404). Retrieved through web open on 2026-09-23.
- In that pinned source, `GetRegistry` uses `public.ecr.aws` when the configured registry is empty. `GetRegistryImageUrl` explicitly supports `docker.io` by returning the original image name. For mirror registries it keeps the final image name/tag component and prefixes `<registry>/supabase/`. `DockerStart` and image pull use that same mapping. Thus both ECR and Docker Hub are supported paths, not an invented registry workaround.
- `command -v supabase` found no installed CLI in this preflight shell. No local image pull or runtime reproduction was executed.

## Recommendation

Smallest bounded change: add step-level environment `SUPABASE_INTERNAL_IMAGE_REGISTRY: public.ecr.aws` to **Clean empty-database replay and verify generated types**. This explicitly overrides setup-cli's exported GHCR setting for the entire disposable replay/typegen invocation. Keep CLI 2.101.0, the replay's PostgreSQL 17.6.1.155 override, all other upstream image versions, excluded services, replay inputs, assertions, native/browser tests, schema fingerprint and generated-type comparisons unchanged.

Prefer the CLI's own default ECR registry over Docker Hub: both are supported, but ECR is explicitly the upstream default for image pulls. Do not replace the Supabase stack with bare PostgreSQL, skip startup, swallow pull errors, relax gates, or update the CLI to address this infrastructure-only failure.

This source inspection proves identical selected image **names/tags**, not cross-registry OCI manifest digest equality. No registry digest comparison or alternate-registry availability claim is made. If byte-identical artifacts are required independently of upstream mirror semantics, compare the relevant platform manifests/config digests and retain the results before making that stronger claim.

## Acceptance

The next actual CI job must show ECR pulls, successful database startup, the unchanged pinned PostgreSQL image version, full canonical replay, all retained native tests and actual case mutation/browser checks, and authentic type/schema generation/comparison. An alternate-registry pull failure remains an infrastructure blocker; a post-start assertion failure must be investigated as its own actual result. This preflight is not native acceptance and does not alter round-5 static case approval.
