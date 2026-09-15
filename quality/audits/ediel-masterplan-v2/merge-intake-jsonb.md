# Preserve the authored customer intake JSONB contract

Status: source decision implemented in a bounded qualifier; actual PostgreSQL execution pending. No migration, historical source, committed schema reference or generated type was changed.

Skill routing: source inspection and verification-before-completion apply to this bounded database contract decision. UI, performance and deployment work are outside its scope. Root owns final independent review, workflow integration and memory publication.

The two May21 sources explicitly add `customers.intake_missing_fields` and `customers.intake_warnings` as JSONB, NOT NULL, default `[]`. Their comments describe additive/idempotent changes. May26 and June10 introduce text[] declarations only when the columns do not exist. Neither issues ALTER COLUMN TYPE or any data conversion. Preserving the existing JSONB columns therefore follows the semantics of all five sources. The old text[] reference alone does not justify rewriting existing data.

Current `lib/website/applicationReview.ts` defines both readiness properties as `string[]` and constructs string arrays. `lib/website/customerApplicationShared.ts` and `app/admin/website-applications/actions.ts` write those arrays directly. `lib/customers/getCustomers.ts` reads the field as unknown. These exact files and all five complete migration sources are hash-pinned by the qualifier. The source decision concerns those supported string-array payloads only: arbitrary JSON objects, numbers, booleans or non-string array members are not declared compatible with text[].

`scripts/canonical_intake_jsonb_qualification.py` retains eight exact conditional declaration fragments, creates a minimal owned customers fixture and executes the statements without changing their ADD/IF semantics. It requires both resulting columns to be JSONB, NOT NULL, ordinary columns, with the exact empty-array default. Its callable parent mode instead inspects the two actual public columns on the admitted existing owned database.

Within one rollback transaction, temporary JSONB and reference text[] records receive the same three JSON input payloads through PostgreSQL `jsonb_populate_record`. The assertions compare JSON output exactly, including element order, duplicates, empty strings, Unicode, escaped quotes/backslashes, comma and braces. Default empty arrays and four SQL NULL rejections are checked. Public catalog/row snapshots must remain unchanged. SQL record conversion models the supported API payload boundary; it is explicitly not an HTTP PostgREST test.

Local validation: five tests PASS for exact source selection/precedence, every changed source and malformed retained plan rejection, valid escaped JSON case coverage, actual-result/state preservation guards and rejection of external targets. Actual PG17 qualification, full-parent integration and final schema/type acceptance remain separate pending gates. No production data was read or modified.

## Actual standalone admission correction

Run35007844361/job104512005711 failed before the first PostgreSQL version query: `POLICY_ACTOR_OWNED_TARGET_REQUIRED`. The qualifier reused full-parent admission, which requires an earlier registered reference and live historical replay. A fresh standalone fixture correctly has neither. This was an invocation-boundary defect, not evidence about the two columns or SQL behavior.

The corrected standalone main registers only its freshly created owned object for its lexical lifetime and unregisters it in finally. That path retains the exact OwnedPostgres class/methods, active owner/name/private-directory guards and existing logging/transport checks; every ordinary parent call still uses the original full-parent admission. A regression exercises a real OwnedPostgres instance without creating a container and rejects unregistered, inactive, renamed and altered-method targets. Six local tests PASS. Actual SQL rerun remains required.

## Actual PG17 result and full-parent boundary

Run35009115834/job104516307686 at commit131dac succeeded. The closed receipt verifies both JSONB column metadata, three exact supported string-array round trips, empty defaults, four NULL rejections, unchanged catalog/rows and completed cleanup. It explicitly records nativeTarget=false, postgrestHttpVerified=false, nonStringPayloadsQualified=false and schemaAccepted=false. This proves the owned standalone source contract; it does not replace a native parent receipt.

The new `execute_parent` path requires full same-target144/514/all-forward admission, excludes standalone fixture objects, and runs once. It checks the two complete public column rows, executes the actual SQL behavior, and requires original catalog, rows, ledger and retained source bytes in finally. Its distinct strict receipt binds the actual column hashes and all nine source/caller pins. The final source-decision map adds exactly these two columns, conditional on that fresh parent receipt, with unchanged committed schema reference.

Expected comparator rows use source-preserved JSONB at physical ordinals31 and36 versus reference text[] at40 and42. Their only differing fields are attnum, column_default, data_type and udt_name. Actual parent rows must match every comparator field; changed ordinals, types, defaults, nullability or identities fail. Nine local tests PASS, including isolated/mutated receipt rejection, exact-column controls and state/source/ledger preservation failures. Actual native-parent execution remains pending.
