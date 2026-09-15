# Preserve the authored customer intake JSONB contract

Status: source decision implemented in a bounded qualifier; actual PostgreSQL execution pending. No migration, historical source, committed schema reference or generated type was changed.

Skill routing: source inspection and verification-before-completion apply to this bounded database contract decision. UI, performance and deployment work are outside its scope. Root owns final independent review, workflow integration and memory publication.

The two May21 sources explicitly add `customers.intake_missing_fields` and `customers.intake_warnings` as JSONB, NOT NULL, default `[]`. Their comments describe additive/idempotent changes. May26 and June10 introduce text[] declarations only when the columns do not exist. Neither issues ALTER COLUMN TYPE or any data conversion. Preserving the existing JSONB columns therefore follows the semantics of all five sources. The old text[] reference alone does not justify rewriting existing data.

Current `lib/website/applicationReview.ts` defines both readiness properties as `string[]` and constructs string arrays. `lib/website/customerApplicationShared.ts` and `app/admin/website-applications/actions.ts` write those arrays directly. `lib/customers/getCustomers.ts` reads the field as unknown. These exact files and all five complete migration sources are hash-pinned by the qualifier. The source decision concerns those supported string-array payloads only: arbitrary JSON objects, numbers, booleans or non-string array members are not declared compatible with text[].

`scripts/canonical_intake_jsonb_qualification.py` retains eight exact conditional declaration fragments, creates a minimal owned customers fixture and executes the statements without changing their ADD/IF semantics. It requires both resulting columns to be JSONB, NOT NULL, ordinary columns, with the exact empty-array default. Its callable parent mode instead inspects the two actual public columns on the admitted existing owned database.

Within one rollback transaction, temporary JSONB and reference text[] records receive the same three JSON input payloads through PostgreSQL `jsonb_populate_record`. The assertions compare JSON output exactly, including element order, duplicates, empty strings, Unicode, escaped quotes/backslashes, comma and braces. Default empty arrays and four SQL NULL rejections are checked. Public catalog/row snapshots must remain unchanged. SQL record conversion models the supported API payload boundary; it is explicitly not an HTTP PostgREST test.

Local validation: five tests PASS for exact source selection/precedence, every changed source and malformed retained plan rejection, valid escaped JSON case coverage, actual-result/state preservation guards and rejection of external targets. Actual PG17 qualification, full-parent integration and final schema/type acceptance remain separate pending gates. No production data was read or modified.
