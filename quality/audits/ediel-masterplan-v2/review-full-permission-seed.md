# Full-clone permission fixture adapter

The new `canonical_permission_full_seed.py` adapts the existing 129 permission decisions for an owned complete replay clone. It does not apply source slices, change production grants, remove triggers, or change candidate functions. Actual PostgreSQL qualification remains pending; Python construction tests are not execution evidence.

Five immutable source pins bind the original fixture, its admission helper and source manifest, the already executed full-schema changed-function fixture, and canonical role/permission identity reconstruction. Source bytes are retained before migration staging. Executed Python sources must remain equal to those retained bytes.

The canonical platform role is resolved by its unique `super_admin` key, platform scope, and active state. Existing permission identities are resolved by the six exact fixture keys; absent test permissions retain the original fixture identities. Every original case body is checked against the original with only these UUID substitutions before count adaptation. No permission outcome is changed.

Each case starts its own transaction, recreates fixture helpers, inserts valid active identities and tenant business inputs, executes one decision body, and rolls back. Auth-created profiles are handled idempotently. Only the resolved platform role's permission rows are temporarily isolated so its four test grants have the original fixture meaning. These seeded role grants are business inputs, not a claim about live platform authority. The original case mutations of role state also remain transaction-local.

Command-result and audit-event assertions use pre-case counts plus the original expected increments. The single global active override count likewise uses its pre-case baseline plus one. No existing audit, result, or override rows are deleted. The adapter removes reduced-schema policy/trigger cardinality assumptions, retains bucket privacy and named single-role index checks, and grants only its own fixture schema, assertion functions, and baseline-count table. Existing public/storage ACLs and all triggers remain effective.

The clone owner must admit the isolated target, retain source bytes before staging, run `identity_query()`, pass its raw JSON document to `build_cases(retained, document)`, require `PERMISSION_CASE_COMPLETE` for all 129 results, and compare the complete catalog, rows, and ledger against the post-candidate clone after every rollback. A failure is a qualification failure; it does not authorize broader grants or weaker expectations.

Validation: five targeted Python tests pass, covering finite identity resolution, exact case count and rollback boundaries, source drift rejection, fixture-only grants, and explicit baseline count adaptation. Actual full-clone execution is required before any promotion.
