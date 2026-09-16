# Changed-view witness: freeze original star expansion

Status: implemented; local controls pass; owned PostgreSQL rerun pending.

Skill routing: systematic debugging and verification before completion apply to
an observed CI witness failure. Source comparison and targeted regression checks
apply. This is a bounded verification correction; no UI, performance, production
deployment, or application permission change is involved.

## Actual failure and cause

Schema workflow35004825267/job104501850630 on ab0c8f49 completed the admitted
144 foundation,514 timestamp and9 forward sources. Its changed-view diagnostic
reported mismatching witness hashes for ordinals2–5. The actual relation hash for
each ordinal still equals the unchanged source-disposition expected hash.
Ordinal1 matched both sides.

The witness had reparsed historical CREATE VIEW queries against the final schema.
PostgreSQL expands a base-table star when the view is created. Later ADD COLUMN
statements do not retroactively extend that stored expansion. Reusing the original
star text at the end of replay therefore constructs a different view, even though
the original view remains correct.

The correction retains the exact original query bytes and SHA256 and separately
renders witnessQuery with explicit historical base-table columns. It changes no
predicate, join, expression, rank, output signature, security setting, migration,
reference fingerprint, expected relation hash, or schema acceptance decision.
All five temporary witnesses must still match the original expected full catalog
row hashes and the actual full rows. The original transaction rollback and
catalog/row/ledger/source preservation gates remain required.

## Source derivation

The immutable register changed-view-historical-columns.json identifies every
column's original declaration line and full source SHA256, covering24 distinct
sources. It was derived from the already admitted foundation order, including the
seven explicit restored-source boundaries, followed by the514 selected timestamp
units in their existing execution order. Initial CREATE TABLE definitions establish
column order. First effective ADD COLUMN IF NOT EXISTS appends a column; repeated
CREATE/ADD statements do not reorder existing columns. No relevant source drops or
renames these columns. The source inspection stops at the relevant view declaration.
The executable witness requires the exact register and all24 exact source files;
it does not derive authority from the current database or from observed view text.

| Ordinal | View / star dependency | Historical columns | Source boundary |
| --- | --- | ---: | --- |
| 2 | customer_contract_lifecycle_readiness_v / customer_contracts | 135 | 20260718160000_v5_signature_switch_readiness_hardening.sql |
| 3 | ediel_active_actor_settings_v / ediel_actor_settings | 37 | restored May21 source after foundation125 |
| 4 | ediel_unresolved_messages / ediel_unresolved_items | 31 | 20260605160000_ediel_backend_automation_foundation.sql |
| 5 | platform_go_live_readiness_v / ediel_actor_settings | 53 | 20260615203000_platform_go_live_route_resolver_message_center.sql |
| 5 | platform_go_live_readiness_v / ediel_brp_settings | 16 | same June15 source |

The actor witness's inner37 columns deliberately differ from its published28
columns plus runtime_rank: the existing source-authorized transition preserves
that outer signature while the inner star sees the restored boundary's columns.
Contact fields already exist then; later legal/production fields do not.

Customer contract columns added after July18, such as billing_eligible_at and
quote_reference, are excluded. The unresolved view predates inbound_quarantine_id.
The June15 BRP lateral query predates the August15 is_active addition. CTE-local
stars remain unchanged because they expand the correctly reconstructed CTE shape.

## Verification

`python scripts/test-canonical-changed-view-witness.py`:11 tests pass. Coverage
includes source-query identity, exact historical exclusions/counts, every one of
the24 source-file mutations, register mutation, duplicate/missing star rejection,
full-row expected hashes, owned-target admission, cleanup/preservation, and
memory-only SQL transport.

These local controls establish the correction's fixed inputs and failure behavior.
They do not establish successful PostgreSQL deparsing or final schema acceptance.
The next gate is an actual owned schema replay with unchanged expected hashes.

Parent compatibility: owned timestamp selftest21, native historical prefix166,
and native schema reference4 pass with the retained source expansion. No copied
fixture authorities needed modification. The shared native runtime rerun is owned
by the parallel index-witness agent; one earlier concurrent process loaded its
pre-correction index helper spelling and cannot establish a current result.
The register's foundation/timestamp ordering hashes are checked against the actual
source-selector constants; changing either constant fails closed. The execution
receipt explicitly binds historicalColumnsSha256.

## Actual remaining ordinal2 and exact source correction

Full schema run35009249751/job104516758408 on fe909783 passes all10forwards,
policy witnesses, addedviews and changedview ordinals1/3/4/5. Onlyordinal2 remains
unmatched: actual/source-expected7007d704402744b49c4384e7746a69ce815094d90c88e88ed2fc2d2741aa7840;
initial128-column witness771656d1904ef42082dddd849a72dd30908a206a2740d9e8b24da7415c1ab766.

The first source extraction omitted two SQL forms: unqualified table names and a
dynamic table loop. Original20260614140000_ops_production_multitenant_readiness.sql
lines91–95 explicitly adds legal_bundle_id,price_book_id,snapshot_quality,
snapshot_hash,billing_blocked_reason to customer_contracts. The original
20260617170000_customer_portal_external_auth_account_repair.sql loop includes
customer_contracts at308 and adds customer_number/external_customer_id at317–318.
Both run after the existing website_application_id addition and before July18
view creation. These exact seven declarations are now inserted at that boundary,
producing135 columns and24 full-source pins. The register hash is
2e3501a24b11881a2158344810afe3bd14c445bbb8f1a04b292e890dbf90ab02.
No observed hash, original source query or other historical expansion is changed.
The11 local tests pass; actual135-column PostgreSQL witness remains pending.

Separately, actual portable run35009249815/job104516757959 passes144+514+10 and
all five final SQL gates with cleanup preserved. This does not imply schema
acceptance or validate the remaining view witness.
