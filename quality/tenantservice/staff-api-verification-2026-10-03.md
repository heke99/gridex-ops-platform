# OPS staff support API — verification checkpoint

The user requires staff-only `support123.gridex.se` in Web, with staff Auth,
customer data and support operations through documented OPS APIs. Source baseline:
OPS `2c8e283e4fb6b232fe4e249352e33e8baeff14b1`. Ediel work is unchanged.

The independent `staff-support-v1` contract is `2026-10-03.1`, raw document SHA-256
`cf524f691b2ebd37ef8dfcc4b898c55fc74a99c930a59089235adbfda2752d71`.
Website/Customer Portal `.4`, archived artifacts and supported floor stay unchanged.

## Published Web qualification

Web PR43 head `f640d29028199006623ac3e3888170e0fbe1b90e`, tree
`4f8ce40d88a5e2f2ba69fb7d6533e52f9c7b2786`, passed all exact-head workflows:

| Workflow | Run | Passing jobs |
| --- | --- | --- |
| Quality, including compiled HTTP action checks | 37161878576 | 111316835621 |
| Native database regression | 37161878583 | PG16.15 111316835592; PG17.6 111316835706 |
| OpenAPI compatibility | 37161878579 | 111316835769 |

Vercel preview `dpl_8EQuim2JX1S5K8dZAdN6mNhVvBnv` is READY for this head:
https://gridex-fknhzdl0a-div3rsa.vercel.app. This is source/build qualification,
not an authenticated OPS provider, Storage or two-company production journey.

An independent actual Next Server Action probe found that the former extension
matcher let legacy customer login run on the staff host. The correction matches
all paths, denies staff mutations before asset exceptions, and rejects staff
hosts in native login and shared customer Auth factories. Compiled tests assert
403 without a native redirect on 14 page/extension/framework/icon/brand paths;
main login and real SVG reads remain usable. Four intentionally admitted staff
API paths also denied native dispatch with zero external/provider fetch attempts.
Full Web tests, lint, TypeScript, production build and 12 mounted staff UI
scenarios pass. CI now requires the compiled HTTP regression after build.

## OPS implemented boundaries

- Separate machine key plus client/tenant-bound personal proof. Native provider
  credentials stay encrypted in OPS; Web holds an encrypted host-only cookie.
- Current native account, session, MFA, password policy and individually unexpired
  contributing permission grants. Platform administrators can read only the key's
  tenant; support writes require current eligible tenant staff and `cases.write`.
- Customer/support projections, keyset pagination, fresh transactional write
  guards, full-body idempotency, atomic effects/events/audit/receipts.
- Upload reservation, stable-path recovery, verified readback/finalization,
  PDF/PNG/JPEG inspection and shared 20/customer/rolling-24h quota. Inspection
  does not establish an antivirus service. Reads 60/min; new mutations 20/min.
- Dedicated native staff-client creation: fixed five scopes/origin, independent
  paused row, checked audit before activation and one-time credential display.
  Staff creation/lifecycle requires current platform authority; the Website
  permission editor cannot convert the staff client.
- Separate service-only staff machine RPC retains the real credential core's
  hash, tenant, scope, IP, origin, expiry and atomic traffic protection. It pins
  all 26 authenticated method/path pairs. Customer/Website profiles are denied;
  Website installation receipts and `api_sales` do not authorize staff.
- Commit-time dedicated-client policy covers business commands and replay,
  atomic vault bootstrap, mutable Auth acquisition/replay and finalization.
  Revoked completion durably blocks the vault/operation and publishes no receipt.
  In-flight read validation and reducing-authority logout retain their policies.

## Verified forward corrections

The first four published staff migration bytes remain unchanged. Eight CLI-owned
forward migrations are now checksum-registered; none is applied to production here.

| Forward correction | Actual evidence |
| --- | --- |
| `20261003224139_staff_api_storage_integrity.sql` | Infrastructure classification and composite company/client FKs; named high-entropy refresh-hash uniqueness exemption, no broad business invariant exemption. |
| `20261003225321_staff_attachment_lock_order.sql` | Real PG16/17 CI exposed quota/case and budget/case lock cycles. The new function uses the shared order and rejects a customer change during quota wait. Native rerun required. |
| `20261003230216_staff_native_account_policy_columns.sql` | Authentic clean-replay schema lacked existing live native password-policy fields and role expiry. Fixture no longer supplies these missing columns itself. |
| `20261003231500_staff_machine_auth.sql` | Actual-source credential SQL proves all 26 admitted route pairs, scope/cost/window enforcement, policy denial variants and unchanged Website readiness. |
| `20261003232132_staff_command_client_policy_binding.sql` | Actual SQL RED reproduced stale profile/kind authority; business/Auth guards and durable finalization block now pass. |

## Executed local and prior CI evidence

Final Node22 OPS suite: **443 files / 6,707 tests pass**. App/test/script TypeScript,
API docs/compatibility/local release, RBAC, performance and service-role ratchet pass.
The five focused auth/client/store/legacy suites pass 50 tests. Initial OPS full
production build and bundle budget passed at the CI 4 GB heap; published initial
quality-release-gates succeeded. The final forward candidate still requires CI.

PostgreSQL17.5 WASM executes all eight migrations against selected actual source
schema/helpers and the historical credential core's exact body/rename/ACL chain.
Business, Auth and machine-auth SQL pass, including isolation/revocation, stale
writes, receipt replay, event/audit rollback, leases, private ACLs, native indexed
writes, full 1,108-customer/311-case/600+-entry traversal and quota boundaries.
This single-connection diagnostic is not full Supabase replay or native concurrency.

Previous native runs exposed a synthetic visibility error, then a real deadlock;
those failing runs are not release proof. The final native runner requires all
8 migrations and adds observed row-owner waits for business/Auth policy changes.
Source `322f9c7` / tree `0e4cc11` passed all 20 actual service-role concurrency
programs on PostgreSQL17.6 (run37162609294, job111318986161, package SHA-256
`7c713401dcad9a6c76808dc499dab9e69f501734c71e8846c069a8a7e7b86f6d`).
PG16 stopped before regression execution because its source PG17 dump contained
the unsupported MAINTAIN privilege. The explicit observed-major fixture adapter
removes only four such table ACL tokens on PG16; PG17/default/WASM SQL remains
byte-identical. Exact final PG16.15/17.6 execution remains required.

Authentic initial replay artifact11287132201 ZIP SHA-256
`63b6a052498cd28676bc9259c7d1307f75fc33ce9e08e2af6c1ccb3a8a79cf3d`
was verified and exposed the native-policy history gap. Fresh all-eight capture
run37162609263/job111318986144/artifact11288273001 was verified against its API
ZIP digest `5f9e20d3acd818a1453ebde6714e50b77836a8436c37b4366b50c11d1c78c875`.
Actual checkout `b683d6840af8a924a26cf8343ddc207cf56069fc`, tree `0e4cc11`, matches
source322f9c7. Its exact generated files are now imported and bound in the manifest:
types SHA `64584abb9f7584c8a3a728020b0b66e52dd882a011e8d1279e2538436969fc1d`,
schema SHA `cba8c51368ced63ceadcdc5b943bd81c02b0f55eb078d3202a8b622b85fbbe00`,
canonical fingerprint `9c3acdc5560066de2bfbee0644556b82f4950d18b29fd2bc7699e25227100764`.
The capture stopped at the expected historical manifest comparison; later parity
and tenant stages still require the fresh final run. No generated bytes were
hand-edited. Migration/typegen/replay inputs are unchanged by this import.
Local migration integrity/generated-type checks pass, and all-eight actual SQL
diagnostics pass against the imported schema. Stale auth-dispatch assertions were
updated, with actual paused/suspended runtime denials added for both API families.
The existing public-guide smoke invariant passes with organization terminology.

## Remaining release work

Publish the frozen OPS correction and authentic capture import, execute native
and full clean replay, and require fresh exact-head green CI.
Then coordinate migration/configuration/deployment with the existing Web cutover
plan and verify real staff/roles/two tenants, provider recovery and Storage.
The current Supabase dashboard account can access Web, but not OPS. Dedicated
keys/server settings, production migrations and staff deployment are not activated.

Known legacy invoice-reference, granular pagination and facility-reference gaps
are recorded in `docs/gridex-api-contract-gaps-2026-10-03.md`. Adding the staff
family does not fix those independent Customer Portal documentation gaps.

Skill routing: source understanding, bounded parallel ownership, test-first
confirmed fixes, security/contract review, Supabase/Postgres and completion gates.
Installed Next16 docs govern the matcher/action/layout behavior. This continues
the existing staff task and does not rerun or replace the separate Ediel audit.
