# Independent support portal — final source qualification

**Code qualification PASS. Named gridex-prod activation NOT RUN.**

The independent portal has its own login, session, invitation callback and
navigation. All new support Auth/API storage must use named `gridex-prod`,
project `ayiuxjlfazkjmmtlvhsl`. Wrong-project requests fail before authentication,
rate/replay, audit or command writes. Existing OPS has not been retargeted and
support123 still belongs to the marketing deployment.

## Frozen code and required CI

| Component | Qualified source | Result |
| --- | --- | --- |
| API | `4fd1b0447400bcfaa0381524c575383eba966297`, tree `260c8a2097c317fcb9d86072248ae1f8391aab9c` | Every required PR578 check PASS; hardening37301295082 SUCCESS2026-10-05T12:05:13Z. |
| Portal | `54b406d82ddb7a26a3bdc510a7fd4b460c4a0cfe` | Required contract/support/website CI PASS;56tests,17Chromium checks, strict types, scoped lint and production support build PASS. |

API hardening includes complete unit tests, types/lint/RBAC/tenant integrity,
quality/performance/bundle checks, production build, API contracts, genuine
ancestor upgrade and full native clean/browser replay. Existing84targeted
onboarding and29case/storage tests have separate receipts, not a distinct
summed total. Original48/15portal evidence is retained;56/17is a separate
qualification after onboarding.

Clean job111734755702 took52m27s. Main native:609declared tests/48files,
608PASS plus one intentional post-browser-only skip. Browser:31/31PASS.
Across26JUnit files:674declared executions,667PASS,7stage/mode skips,
0failures/errors. Owner reruns are not unique scenarios. All18recorded
native/browser phases complete, including verification after browser actions.

The onboarding SQL regression is called unconditionally with
`psql -X -v ON_ERROR_STOP=1` by the frozen workflow. Successful blocking
execution and its command/output binding establish the result. The script
emits no unique named onboarding PASS notice; none is invented as evidence.

## Authentic artifacts

- Clean11343703305: ZIP SHA256
  `407b6d6349083dec2fbbd1f0175efc50db7031fc9f4aa17c64a0ab92abe40ac3`;
  run37301295082/job111734755702, authenticated source4fd.
- Upgrade11340779653: ZIP SHA256
  `3f7f5a7d65eed5bca1963142064f09ff53c439486d62846c804fe0181a8b1476`;
  same run/job111734755731. Genuine53bf ancestor,421forward hashes and
  179additional history-union hashes match immutable source.
- Types SHA256
  `5cb5b93bd6a421411acee540aced6feebaa146b1879cc86a4fb47513a4c54dc8`;
  schema fingerprint
  `540f95baa06c40827e02cae3b7ffc2090b3e206bd9c5a715001dbc50488e424b`.

All three upgrade branches have identical types and fingerprint objects. Their
raw SQL differs from the original capture only in leading whitespace on42lines;
raw fingerprint differs only in serialization. Imported raw bytes and complete
prior provenance remain unchanged. Capture-only37299065849 is separately
scoped historical generation evidence, not this final native acceptance.

Immutable safe receipts: [final manifest](final-source-evidence-20261005/manifest.json).
This documentation is published on a separate documentation branch descended
from4fd. Production source, migrations, generated artifacts, tests and both
tested PR heads remain unchanged; no repeat suite is needed for these receipts.

## Remaining named-prod work

Read-only inspection confirms the different Prod baseline lacks the required
Staff/canonical/runtime structures and a verified Gridex company/admin.
The12:04:35UTC catalog additionally confirms five queried acceptance/worker
RPCs absent. Existing profile status defaults active and company/user membership
uniqueness exists; Auth/profile trigger behavior and role grants remain unqualified.

Use the [original prerequisite map](gridex-prod-prerequisite-map-20261005.md)
and [onboarding addendum](gridex-prod-onboarding-prerequisite-addendum-20261005.md)
to build a faithful Prod-shaped fixture and bounded guarded dependency bundle.
Never replay all1067historical OPS inputs into Prod, fabricate readiness or
historical command/ledger rows, copy dev UUID/users or silently merge marketing
tickets. Genuine global readiness, or a separately reviewed Staff capability
gate also covering pre-membership onboarding, requires qualification.

Company/admin identity is required before enrollment. After structural
qualification: bind the runtime to Prod, enroll the dedicated company client
and Staff provider, allow the own Auth callback, qualify real leased delivery
and acceptance, then create the independent support project and move the domain.
No hosted migration, data/enrollment, Auth setting, real email, environment change
or domain reassignment occurred in this task.

API: https://github.com/heke99/gridex-ops-platform/pull/578

Portal: https://github.com/heke99/gridex-web/pull/45
