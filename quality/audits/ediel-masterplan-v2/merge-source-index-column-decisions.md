# Bounded index and column source decisions

Status: pure source-decision module implemented; native integration pending.

canonical_schema_index_column_decisions.py maps exactly51 removed indexes and14
changed non-type columns. It requires the immutable positive remaining-index and
column-remainder reviews, predecessor index evidence, schema.sql, and every SQL
source hash enumerated by those reviews:73 pinned files in total. It does not
promote the general acceptance inventory into approval.

All51 reference index rows are reconstructed with the complete six comparator
fields from the exact schema.sql lines and checked against the audit's hashes.
All28 before/after column rows are reconstructed with all ten comparator fields,
including exact physical ordinals, defaults and nullability, and checked against
the audit's hashes. The precise changed-field lists are computed from those rows.

The51 index decisions remain distinguished:25 exact renamed,1 unchanged exact,
22 wider leading-key,1 non-NULL partial,2 source-preserved absent nonunique access
paths. No equal planner cost, NULL lookup coverage, benchmark, lost uniqueness or
performance acceptance is inferred. validate_context requires all48 added survivor
identity/hash rows exactly once and the1 reference-retained survivor unchanged.
A caller must invoke that context guard; final SQL success alone does not prove
the promised survivor indexes exist.

approved() returns65 central decision mappings with witness=nativeFinalSql.
validate_execution_receipt requires native=True and the exact five successful
original SQL checks, all catalog/row/ledger preservation flags, unchanged source
hashes, and false schema/type acceptance flags. Central integration must retain
this original execution receipt in the cleaned native comparison and bind it to
the enclosing report. This module cannot generate or fabricate execution evidence.

Independent artifact verification: found the original335f987f ZIP in prior scratch
and recomputed SHA2564009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb.
Its only member full-schema-reference-diff.json hashes to
483a086d05f357f44a46bf48e0464b771cf288dece12660185dafcebf9857a75.
All65 reconstructed rows exactly match the original artifact rows; their ordered
projection SHA256 is af7db59ffae680b7e50c8c7cfae0b2279fb28b9dfdf143a08dd6e568803e4409.
All48 added and1 retained survivor context checks pass on that original diff.
This is original portable evidence, not a fresh native success claim.

The same member contains723 attnum-only changed pairs. Its metadata includes exact
identities, changed fields and two hashes, but not full column rows/ordinals. The
existing bounded column audit explicitly excludes those723 from its review.
No723 approvals or invented full rows are added. A separate source/positional-use
review and exact input register would be needed to justify such a decision.

Local tests:6 pass, including all73 changed source pins, exact65 artifact digest,
240 missing/changed/duplicate survivor cases, unchanged-survivor reclassification,
unknown index shapes, native-only admission and false/truthy/missing finalSQL flags.
No reference, migration, application type, performance or global acceptance changes.

Skill routing: bounded differential/source review, systematic validation and
verification before completion apply. No UI, performance measurement or production
mutation is involved.
