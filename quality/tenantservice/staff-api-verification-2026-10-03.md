# Separate OPS staff support API — verification checkpoint

This feature continues the user's authorized Gridex Web/RBAC/support plan. Web
must use documented OPS APIs for staff authentication and all customer/support
data. The staff-only Web host stays `support123.gridex.se`; it does not host the
native OPS console. The source baseline is OPS `2c8e283e4fb6b232fe4e249352e33e8baeff14b1`.

The frozen standalone contract is `staff-support-v1`, version `2026-10-03.1`.
Current and immutable document SHA-256:
`cf524f691b2ebd37ef8dfcc4b898c55fc74a99c930a59089235adbfda2752d71`.
Legacy Website/Customer Portal `.4` and its supported version floor remain unchanged.

## Implemented behavior

- Dedicated machine key plus OPS-issued, short-lived personal proof. Encrypted
  provider credentials stay in the OPS vault; Web receives no native tokens.
- Native account/session/MFA/password state, current permission definitions and
  individually unexpired contributing grants are checked. Platform administrators
  can read only the API-key tenant and cannot use the staff write exception.
- Recovery eligibility is checked before native recovery-link generation.
- Tenant-forced customer/support projections and complete DB keyset pagination.
- Service-only transactional commands reauthorize after waits, bind actor/client/
  company/session, and atomically commit effects, events, audit and replay receipts.
- Upload reservation precedes Storage; verified readback and finalization preserve
  an original-key recovery path. PDF/PNG/JPEG inspection and content hashes are
  enforced. This is content inspection, not an antivirus service.
- Read 60/min; new mutations 20/min; authorized exact replays are free. The shared
  20/customer/rolling-24h attachment quota is serialized across insert paths.
- Native support read guards use their dedicated permission instead of unrelated
  operational task permissions.

## Executed local checks

- Node 22: full OPS suite, 440 files / 6,682 tests; targeted mounted authentication,
  resources, attachment and contract suites also pass.
- App/test/script TypeScript at the workflow's 4 GB budget; lint has zero errors
  and 104 existing non-staff warnings.
- API documentation, compatibility, local release, RBAC (24 checks), performance,
  dependency audit and service-role ratchet pass.
- Optional PostgreSQL 17.5 WASM diagnostic executes the actual selected source
  tables/native permission helpers and the four forward staff migrations. This is
  a single-connection diagnostic, not a full Supabase replay or PG16/17 native proof.
- SQL behavior covers wrong client/company, permission definition/individual-role
  revocation, native session expiry, password restrictions, stale updates and closed
  cases, original-key replays, event/audit rollback faults, attachment lease recovery,
  and complete traversal of 1,108 customers, 311 support cases and more than 600 entries.
- Authenticated insert/update on all three indexed native tables succeeds while
  private staff helper EXECUTE stays denied; EXPLAIN uses each reference index.
- Browser-role access to private vault/receipt tables and command RPCs is denied.

## Review-driven corrections

The diagnostic caught and corrected an Auth helper dependency-order error and
private-function index ACLs that broke existing native writes. Review also corrected
expired role/permission/platform grants, recovery issuance before eligibility,
timestamps captured before lock waits, and transaction-start expiration checks.
The fourth CLI-created migration classifies Auth infrastructure and adds composite
company/client foreign keys without modifying registered earlier migration bytes.
The tenant invariant gate names the vault's high-entropy refresh-hash uniqueness as
a credential exemption; no business-key isolation check is disabled.

## Remaining release gates

Native PG16.15/17.6 observed-wait/concurrency scenarios, full Supabase clean replay,
generated DB types/schema/fingerprint from that replay, frozen-tree build/bundle and
exact-head CI remain required. Provider/Storage and authenticated two-company live
verification are not implied by local mocks or the WASM diagnostic. Production
migrations, keys/scopes/recovery origin and Web deployment are not activated here.

The published legacy API still has invoice reference, granular pagination and
stored-versus-meter facility reference gaps. See
`docs/gridex-api-contract-gaps-2026-10-03.md`; do not invent undocumented joins or DTOs.

## Skill routing and scope

Applied repository understanding, plan/execution, parallel ownership, targeted
test-first debugging, code-security, spec-to-code, Supabase/Postgres and completion
verification workflows. Next.js route/layout owners read installed Next16 docs.
Static threat/permission/DTO/storage review and actual behavioral tests were used;
this is a narrow staff feature, not a repeated repository-wide 42-skill audit.
Ediel/masterplan tasks, rollout flags and production data are outside this change.

Next: publish the source-only draft, obtain clean-replay artifacts, install the
generated files without hand edits, and qualify the resulting exact commit before
coordinated production configuration/cutover.
