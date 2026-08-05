# Gridex OPS — API Configuration and Contract Integrity

## Overall status

- Source-level API configuration: `verified` in reviewed paths.
- Immutable OpenAPI release `2026-08-05.2`: `fixed` and verified by hardening CI.
- Deployed runtime parity: `blocked` without approved staging credentials and tenant/API-client fixtures.
- Environment configuration: documented but not fully machine-enforced.

## API surfaces

| Surface | Owner/consumer | Auth and isolation | Contract source | Verification |
|---|---|---|---|---|
| Website integration | Gridex OPS → tenant websites | bearer API client; company derived server-side; scopes/status/origin/IP/rate limits | `docs/openapi/website-integration-v1.json` | compatibility/release scripts in expanded CI; live parity blocked |
| Customer Portal | Gridex OPS → tenant customer portals | bearer API client; company derived server-side; scoped customer identity | `docs/openapi/customer-portal-v1.json` | error-contract regression and release scripts; live parity blocked |
| Internal cron/automation | Vercel scheduler/operations | dedicated secret and permitted `CRON_SECRET`; timing-safe comparison; fail closed if none configured | route code and `vercel.json` | source inspection; deployed invocation blocked |
| Provider webhooks | external providers → OPS | provider signature/timestamp/raw-body rules | route/provider code | reviewed paths only; provider fixtures blocked |
| Versioned OpenAPI documents | API consumers | public immutable documents | `docs/openapi/releases/<version>/**` and versioned routes | release finalization and route checks |

## Current contract version

The current repository contract version is `2026-08-05.2`.

V3 reproduced a release-integrity defect:

1. run `31052421121` failed because immutable website/customer-portal snapshots were absent;
2. after materializing them, run `31052649096` failed because immutable versioned routes were absent;
3. commits `c39794361ec342d5e75a530136724f779f1f2b5e` and `f5d81c726dbe3f023f00e3f99c3a33829e5a9ac1` added the exact canonical blobs and established route pattern;
4. run `31052844335` completed successfully.

No canonical schema field was manually rewritten during this correction.

## Request, response and error contracts

Verified patterns in reviewed code:

- external request bodies are bounded and validated;
- integration tenant/company context is derived from authenticated API-client records, not trusted request claims;
- scope, client status, tenant status, origin/IP and rate limits fail closed;
- API errors use stable machine-readable codes and request IDs;
- unexpected 500 details remain generic;
- controlled Customer Portal parser errors now preserve 400/413 status, code and field;
- versioned OpenAPI routes use immutable cache headers.

The dedicated Customer Portal error regression passed in the expanded V3 workflow before the later full-suite fixture failure.

## Contract and fixture drift fixed in V3

The expanded test matrix found stale tests rather than a need to weaken production validation:

- three new-publication legal fixtures used `content_sha256: null` despite immutable evidence requirements;
- one route regression compared current response headers against historical version `2026-08-04.3`.

Only test evidence was updated. The explicit historical-null test remains and production legal hashing remains strict.

## Environment variables

The repository contains `docs/env-production-checklist.md`, a broad production inventory based on a point-in-time grep. A canonical `.env.example` and a single typed/generated environment schema remain absent.

Verified controls:

- public Supabase variables are separated from server/service credentials;
- scheduled auth rejects requests if no accepted secret is configured;
- missing required Supabase runtime values throw outside the production-build placeholder phase;
- no secret was added to client code or audit reports.

Risks/gaps:

- build-time Supabase placeholders mean a green build is not proof that deployed credentials are correct;
- prose documentation can drift from code;
- live Vercel/Supabase/email/EDIEL secret presence, rotation and environment separation were not inspected;
- origins/callbacks and provider credentials require deployed validation.

## Keys, tokens and scopes

Reviewed integration authentication provides:

- server-stored API-client identity;
- tenant/company binding;
- status and scope checks;
- optional origin/IP restrictions;
- atomic rate-limit handling;
- structured request logging.

No verified client-controlled tenant override or anonymous execution path was found in the reviewed core integration flow. Full API-client rotation/revocation runtime testing remains `blocked`.

## Stale data, idempotency and concurrency

Repository controls include:

- publication revisions and ETags;
- immutable contract-version documents;
- idempotency keys in relevant integration/event paths;
- dedicated multitenant quote-idempotency regression;
- conflict/error classifications.

The expanded CI includes API compatibility and release verification. Deployed `If-Match`/ETag behavior and real concurrent client scenarios remain `blocked`.

## Webhooks and resilience

Reviewed webhook paths use signature verification before processing, bounded raw payloads and replay/timestamp checks where applicable. Remaining unresolved item is `BUG-002`: billing target resolution and bad-signature failures may be externally distinguishable. It remains `unverified` until provider retry semantics and a safe fixture are available.

No live provider event was sent during the audit.

## Required live parity validation

Before staging readiness:

1. deploy the final audit commit to an isolated preview/staging environment;
2. use approved tenant-bound API clients;
3. compare current and immutable OpenAPI responses, headers, ETags and error envelopes;
4. run valid/invalid scope, disabled client, disabled tenant, wrong origin/IP and rate-limit cases;
5. run two-tenant negative tests;
6. run webhook valid/invalid/replay/duplicate tests;
7. confirm no production customer or external recipient is affected.

## Verdict

`partially_fixed`

Repository contract integrity and the reproduced `2026-08-05.2` release defect are fixed at source/CI. Runtime environment and deployed parity are still blocked.
