# Bounded review: 723 physical column ordinal differences

## Decision and limits

The exact reviewed 723 changes may be preserved as physical-order schema differences under the finite conditions below. This is not column-order equivalence, external positional ABI compatibility, a performance claim, or permission to ignore other `attnum` changes. No database or acceptance module was changed by this review.

The independently checked original artifact is `pr310-schema-335f987f.zip` (272701 bytes, SHA256 `4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`). Its `full-schema-reference-diff.json` member is 1381367 bytes, SHA256 `483a086d05f357f44a46bf48e0464b771cf288dece12660185dafcebf9857a75`. Exactly 723 changed-column records have `fields == ["attnum"]`, across 39 relations. It supplies exact identities and both row hashes, but not full column rows or numeric old/new ordinals. Those absent values must not be invented or described as independently reconstructed.

## Evidence

`scripts/canonical-full-schema-reference.py` computes changed fields from actual validated reference/replay row comparisons. `scripts/sql/gridex-db-parity-introspect.sql` projects ten column fields: namespace, relation, ordinal, name, formatted type, underlying type name, nullability, default, identity, and generated status. An owned execution of that comparator with an exact registered hash pair and `fields == ["attnum"]` establishes equality of the other nine projected attributes. A freestanding manually supplied diff does not establish that provenance.

Application queries inspected consume named PostgREST objects. `lib/performance/companySummaries.ts` calls the dashboard RPC, or selects `*` into an object and reads named properties. `lib/website/customerApplicationSchemas.ts` sorts object keys before its application payload hash; billing approved-dispatch stable serialization also sorts entries. The `Object.values` use in `lib/customers/customerCardSnapshot.ts` feeds normalized legal types into a Set, so its inspected use does not depend on property order. A lexical scan of app/lib found no `rowMode`, `arrayMode`, `.csv()`, raw `SELECT *`, or direct pg/postgres import.

Same-table row variables are used in SQL. For example, `20260901151000_canonical_contract_price_area_binding_schema.sql` selects customer_contracts `*` into customer_contracts `%ROWTYPE`, then accesses named fields. Both sides resolve against the same catalog, so this pattern is internally coherent despite physical ordering changes. It does not prove compatibility of cross-table row assignments or external composite serialization.

Lexical scans of pinned `supabase/schema.sql` and all current migration SQL found no affected-relation bare `INSERT INTO relation VALUES/SELECT/TABLE`, bare `COPY relation TO/FROM`, or `::relation` composite casts. The schema scan also found no corresponding explicit CAST-to-table pattern. These searches are supporting evidence, not a SQL parser or proof that dynamic SQL and external consumers are absent.

The affected set includes `canonical_internal_contract_offers_v`. View output order and expanded `SELECT *` definitions must remain separately checked. The historical changed-view mismatch already demonstrated that final table column sets cannot substitute for source-time star expansion.

## Required finite acceptance conditions

1. Pin the original artifact/member hashes and exact 723 identities, reference/replay hashes, and singleton changed-field list. Require each once and reject missing, duplicate, altered, or new records. Do not introduce a generic attnum normalization or a count-only exemption.
2. Require the existing owned native reference/replay lifecycle and comparator provenance, including retained source pins and cleanup. The reviewed diff register alone cannot attest execution or reconstruct unavailable numeric ordinals.
3. Keep relation/view definitions, source-time view expansion witnesses, routines and their argument/return contracts, explicit composite types, enums, constraints, indexes, permissions, policies, and non-ordinal column changes under their own independent gates. Do not let this decision discharge any of them.
4. Preserve the reference and replay schemas as observed. Do not reorder live columns, rewrite observed row hashes, or mutate historical migrations to make the register fit.
5. Document positional consumers as outside the compatibility claim. If an affected-table positional INSERT/COPY, array-row SQL client, cross-table composite assignment/cast, or external positional row contract is identified, block that relation until its explicit column mapping or ABI behavior is verified. Passing named PostgREST callers does not prove arbitrary external SQL compatibility.

Within these conditions, there is no concrete application blocker found in the inspected source. The positive disposition is preservation of an exact observed physical-order difference, not a claim that physical order can never affect behavior.
