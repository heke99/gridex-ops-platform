# T36 — actual intent consumer, authenticated callback and protected denial

This second scanner package connects the real durable intake intent to a
dedicated consumer and provides authenticated internal callback and protected
read endpoints. Actual approved malware scanning remains unconfigured. There
is **no release branch**: every response keeps `releaseAllowed=false`, the
stored file remains private/quarantined and no endpoint returns file bytes or
a download URL. These local mechanics are implementable and tested; they do
not qualify a production scanner or close the full T36 requirement.

## Actual gap and preserved boundaries

The existing canonical outbox deprecation trigger immediately marks an intake's
`customer.support.attachment.scan_requested` row processed and mirrors it into
the generic webhook bus. That is not scanner consumption. The new private
queue derives each job from that exact durable intent even when the generic
bus already processed it. Its original source binding is immutable and is
rechecked against current committed intake, owner, domain event, Storage object
and scan lineage at bind/callback/completion. Neither event bus is rewound or
repurposed.

The CLI-created forward is
`20261001002726_support_attachment_consumer_protected_read.sql`. The previous
ten-file scan receipt package, historical migrations, public version 3.3
contracts and existing upload/list behavior are unchanged. This owner changes
no workflow, generated schema, checksum registry, release contract or Git ref.

## New actual callers and policy

| Internal endpoint | Current authority and result |
| --- | --- |
| `POST /api/internal/customer-support/scanner/process` | Dedicated server process bearer, strict bounded body and service-owned fair claim. Default production adapter is absent, so claimed work is durably `blocked_scanner_qualification`; no external dispatch occurs. |
| `POST /api/internal/customer-support/scanner/verdict` | Separate server callback bearer plus actual current locally verified RS256 issuer/key proof. Caller submits only nonce and token. Tenant, owner, challenge and current job token come from the authoritative stored nonce. |
| `POST /api/internal/customer-support/attachments/[attachmentId]/download` | Current canonical OPS `cases.read`, verified Auth user/session, selected tenant, exact customer/owner and parent case corridor. Creates a 60-second denial nonce; same-origin POST required. |
| `GET` on that same protected path | Same current OPS authority, exact actor/session/owner-bound nonce header, current Storage bytes and final database authority/expiry recheck. Consumes the nonce and returns only a safe **423 blocked** JSON decision. |

The OPS route does not confer portal rights. The underlying protected-read
command independently applies actual portal/customer publication and visibility
rules when used by a portal context; an internal attachment remains inaccessible
to a portal owner. No new versioned public API or portal download route is added.

The queue caps each batch at 20 and each tenant at five, with persisted tenant
turns, original intent availability and `SKIP LOCKED`. A 250-row noisy tenant
cannot omit another tenant's one eligible intent. Expired processing claims are
boundedly held for review instead of automatically redispatched. Completion is
current-token bound; a missing verified receipt cannot produce
`evidence_recorded`. Per-item errors do not abort later tenants. Private
protected-read limits are finite: 20 issued nonces per actor/company/minute
across session/customer changes and 1,000 simultaneously live unconsumed
nonces per company. These are local safety ceilings, not an SLA.

The controlled adapter interface can return signed evidence or await a callback.
Its production resolver returns absent. A test issuer signing a clean verdict
does not constitute provider approval. The adapter, private byte reader and
callback cannot generate a release or alter the public quarantine state.

## Transaction, revocation and safe transport

The callback verifies exact current server issuer/key/purpose/nonce/lifetime and
the stored binding, reads and hashes the actual reserved bytes, then verifies
server trust and signed expiry again. The new service-invoker callback RPC
invokes the existing exact receipt owner and completes the current job in the
same transaction. It reacquires current root/nonce/lineage and checks signed
expiry **after** the final queue write, so a late lock/trigger wait cannot commit
an expired receipt/completion. Exact replay revalidates current roots, stored
source and expiry and has no second effect. Altered replay, revoked roots,
changed bytes, stale job tokens and changed source bindings fail closed.

The scanner is a service-owned quarantine effect. Original upload session
identity was not persisted in the old intake receipt; this package does not
invent it or impersonate a current end-user session for a machine callback.
Current user/session/account/membership/visibility is required independently
for every protected read, including after private byte inspection. Consumed,
expired, foreign-owner or differently bound read nonces are denied.

Callback input is streamed with a 10 KiB/5-second bound, strict JSON fields and
an 8 KiB token limit. Process/read bodies are bounded at 512 bytes. Transport
secrets default absent and require bounded bytes; constant-time comparison is
performed only for equal buffer byte lengths. Unauthorized/malformed input
does not reach signature, database or private Storage work. Responses carry
no-store, nosniff, sandbox/frame denial, same-origin resource policy and no
referrer headers. They do not echo tokens, Storage paths or file contents.

## Executed RED/GREEN and qualification

| Evidence | Actual outcome | Boundary |
| --- | --- | --- |
| Original missing consumer/read functions | **2 RED**, SQLSTATE `42883` | Actual absence before the new forward |
| Original missing exported worker/HTTP helpers | **4 RED** | Actual absent module boundary |
| Actual new forward and existing authority/scan owners in PostgreSQL core | **9/9 PASS** | PGlite PostgreSQL 17.5 on a bounded schema; not full Supabase history |
| Actual exported worker, local signature verification, callback and protected route handlers | **12/12 PASS** | Controlled RPC/Storage/Auth adapters; no live provider or Auth-cookie/server acceptance |
| Scoped source/runtime/native TypeScript, ESLint, whitespace/diff checks | PASS | Bounded local gates; root owns broader integration checks |
| Genuine full-history native suite | **6 authored, 0 executed — NOT_EXECUTED** | Root CI execution pending |

Candidate self-review/independent review exposed and corrected three real local
implementation defects, separate from the original missing-feature RED:

- Initial seed timing could make a newly inserted job later than the claim's
  captured clock. The consumer now retains the original due intent time; first
  consumption and limit-one tenant ordering are covered by actual SQL.
- A scanner root could expire while the final queue completion trigger waited,
  after the receipt owner's earlier clock check. A real `pg_sleep` case produced
  **RED**, then **GREEN** with a final outer check and rollback of receipt, nonce
  consumption and queue completion together.
- Multibyte unauthorized bearer values initially escaped both actual handlers
  through `timingSafeEqual`'s unequal-buffer exception: **2 RED**, then **GREEN**
  with bounded buffer-length checks and safe 401/security headers.

Core cases cover bridged intent consumption, fair 250+1 sampling and durable
rotation, exact callback replay/final-fault rollback, late root expiry, low-role
and input denial, stale tokens/missing receipt/source drift, protected-read
owner/witness/expiry/session denial, stable actor and shared tenant limits and
portal/internal visibility. Runtime cases cover default-zero dispatch, actual
controlled RS256+physical-byte evidence, authoritative callback fields, changed
bytes/current server key revocation, per-item isolation, bounded transport,
actual protected route exports and current authority after byte inspection.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/support-attachment-consumer-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/support-attachment-consumer-20261001.config.ts
```

Prepared genuine native command:

```sh
CI=true GRIDEX_NATIVE_STATUS="$candidate_status_path" node node_modules/vitest/vitest.mjs run --config scripts/support-attachment-consumer-20261001-native.config.ts
```

Native fixtures use actual support commands, Auth/session rows, private Storage,
both real forward owners, current nonce/job RPCs and a controlled signing key.
They prepare default-block consumption, actual controlled adapter/loopback HTTP
callback replay, two real concurrent transactions, late job fault and current
root revocation, real current portal-owner/session denial and root expiry during
the final write. The final-expiry fixture now increments a fixture-owned PostgreSQL
sequence immediately before its exact job-update sleep and requires one surviving
sequence increment after rollback. A root that expires before that hook is reached
fails the witness assertion; an early denial cannot qualify final-write timing.
Only this temporary sequence grants `service_role` USAGE, and it is removed with
the temporary hook. The loopback HTTP case runs the actual handler, not a deployed
Next/Auth-cookie route or approved scanner transport. Immutable evidence,
synthetic companies and stored objects remain until disposable teardown; only
fixture-owned temporary fault hooks are removed. No external scanner call or
local native PASS is claimed.

## Exact remaining outcomes

Production scheduling/credentials must be connected by the owner of the real
scanner integration. The configured production adapter and independently
approved malware verdict behavior/protected scanner transport are exact
external qualifications, currently absent. This package deliberately provides
no approval/configuration shortcut or release branch.

The current consumer/callback/protected denial mechanics are locally verified.
Full-history RLS/ACL, actual two-session scheduling/Storage atomic version
behavior and the prepared native suite remain pending genuine CI. Current
OPS Auth cookies and the served protected route need an actual Next/HTTP proof;
the runtime adapter test is not that result. Any future file release would
require a separately reviewed protected delivery implementation and verified
provider qualification. Full T36, wider T25/T40/T42, the original 75 outcomes
and full OPS/browser acceptance therefore remain open to their exact evidence
and dependency boundaries, not blanket external blocking.

## Independent review and native timing witness, 2026-10-01

`ops_ui` independently executed both frozen packets: first scanner **8/8 actual
SQL core + 14/14 runtime**, consumer **9/9 actual SQL core + 12/12 runtime**,
and matched all 25 frozen file hashes. Its bounded current source review found
no remaining authorization or zero-release blocker. This does not qualify native
execution, approved malware detection, deployed cookies, or actual file release.
The review identified that the prepared final native expiry case could accept
an early denial without proving its sleep hook was reached. The narrow fixture
correction above adds a nontransactional sequence witness, preserving the actual
production SQL and the previously established core RED/GREEN rollback evidence.
The revised genuine native suite remains **6 authored, 0 executed**.

The exact revised native trigger text was separately executed on PostgreSQL17
PGlite: **2/2 timing-witness checks** passed (early denial leaves `is_called=false`;
final job update increments once despite rollback while the job stays unchanged).
This is a bounded fixture check, not genuine native execution. Narrow source/runtime/
native TypeScript, fixture ESLint and diff whitespace checks passed again.
