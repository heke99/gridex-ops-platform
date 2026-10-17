# Confirmed operational customer-source consistency

The seventh forward migration is narrowly limited to the existing
`ediel_portal_test` customer source. No additional source modes or unproved
status exclusions were added. The previous six applied migrations were unchanged.

## Reachable production write

The portal-test creator writes a draft customer with `source=ediel_portal_test`
(`lib/ediel/portalTestCustomer.ts:769`, source at 778) and a draft point at 975.
`app/admin/ediel/actions.part-4.ts:607` exposes the authorized graph creator.
The ordinary `saveMeteringPointAction` at
`app/admin/customers/[id]/actions.part-1.ts:804` accepts an owned point's active
status through the real `meteringPointInputSchema` and `saveMeteringPoint`
(`lib/masterdata/validators.ts:28`, `lib/masterdata/db.ts:638`). Its company/site
ownership checks do not prohibit editing a portal-test customer's point.
The customer mutation context/entity guard checks company ownership, not source.
The read-only live catalog review found seven point UPDATE triggers; the relevant
company/onboarding/identifier/audit/correction checks impose no separate activation
receipt for this normal masterdata edit. Canonical ingestion writes `value_kwh`.

This concrete path was reproduced with the real validator and database writer,
backed by a PGlite Supabase adapter. The original scanner counted the activated
portal fixture although the existing `gridex_company_has_customer_data` rejected
its customer. Its canonical negative historical value also produced an actionable
`invalid_metering_value` issue. No reachable `deleted_test_only` production writer
was established, so that speculative status expansion was stopped.

## Shared source predicate and bounds

CLI created
`supabase/migrations/20261013130700_operational_quality_customer_source_consistency.sql`.
Frozen SHA256:
`0b1638fbd4ab1eef82dc95d2064519e66f1bbb787a8213c9a705d1ddb1ea5732`.

New private `gridex_quality.operational_customer_source_v1(company,type,id)`
excludes only an exactly matching same-company portal-test customer, or a point/
value whose same-company parent chain reaches that customer. Missing, NULL,
inactive or cross-company parents do not decide a source is test data. The helper
is stable, read-only and SECURITY INVOKER. Only authenticated/service roles receive
schema USAGE and helper EXECUTE; PUBLIC and anon receive neither. Table privileges
and RLS remain unchanged; the helper returns only the eligibility boolean.

Existing public signatures and read-view columns are unchanged. The helper drives
active point/customer validation, the selected-month physical missing-value
helper, the scanner's point/customer/negative-value source selection and known
operational issue visibility. Physical validation with `requires_active=false`
continues to recognize retained source rows. Ordinary inactive/orphan negative
values remain actionable. Unknown manual rule kinds retain their physical-source
visibility and histories; successful managed reconciliation resolves prior portal
findings rather than deleting their history. The forecast deviation branch already
joins the scanner's point CTE and consequently shares this point eligibility.

## Verification

The final production-DDL PGlite fixture passed 3/3 tests, including two migration
replays, the supported admin activation writer, canonical negative value before/
after, retained resolved history, ordinary/inactive/orphan values, NULL-parent
points, tenant isolation, foreign-parent source non-interference, unknown manual
issue preservation, and invoker/ACL checks. Targeted lint and diff check passed.
An initial 30-second setup timeout during concurrent verification was retried with
a bounded 90-second setup allowance; the final run passed in 40.03 seconds.

`customer-source-native-regression.sql` repeats the database assertions with real
migration source and production issue/alert/forecast DDL in a separate empty local
PostgreSQL database. It is explicitly a synthetic fixture, rolls back all its
changes and must never run against production or the authentic schema capture.
The native fixture passed on PostgreSQL 17.5 in the separate local database
`gridex_quality_source_20261013`, emitted
`native_customer_source_regression_passed` and ended with ROLLBACK. This fixture
uses minimal source relations; it does not replace root’s complete authentic
schema/FK replay. Root alone owns live apply, checksum registration and authentic
type capture.
This preparer made no live data/schema writes. Root subsequently confirmed this frozen seventh applied and captured, followed
by the portfolio owner’s eighth consumption-forecast source guard. Root owns
the corresponding live/capture receipts.
