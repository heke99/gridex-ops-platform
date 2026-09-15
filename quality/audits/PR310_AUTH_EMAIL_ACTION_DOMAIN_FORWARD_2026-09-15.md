# PR310 auth email action domain correction — 2026-09-15

Status: staged candidate and offline qualification implementation. Real PostgreSQL 17 execution and genuine CLI-created filename evidence are pending. No migration is promoted by this audit, and no historical auth source, reference schema, ledger or production data is changed.

## Confirmed incompatibility and correction to the earlier audit

The final retained `public.auth_email_events.action` column is text, NOT NULL and has no default. Supplying the missing action in the two active application writers fixed an omitted-field 23502 failure. It did not fix the separate action-domain mismatch. The earlier relation/column audit incorrectly called the May20 eleven-value CHECK final, and its 15 module tests mocked that intended domain. That claim is corrected in `PR310_ADDED_RELATION_COLUMN_DISPOSITIONS_2026-09-15.md`.

The observed final validated action CHECK has seven values. Its full comparator row SHA256 is `b14da2bb4421f49b889f1e5c740f1a1cd376392401ec863a89a787d067ab9083`. This is reconstructed in the added-constraints audit from retained full-schema evidence, including the 9f artifact `10399581944`, ZIP SHA256 `0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af`. The approved September legacy boundary restores the first-43 captured CHECK definitions; source order alone therefore does not make the earlier eleven-value declaration final.

| Authority | Exact evidence |
|---|---|
| Original seven-value CHECK | `supabase/migrations/20260519_auth_callback_email_reset_sync.sql:59–71`, file SHA256 `59efbf233d314558f8cc7ffbb2b15788cadaaf7ba476e0f80fa1e820299419a9` |
| Intended eleven-value CHECK | `supabase/migrations/20260520_direct_temporary_password_auth_sync_fix.sql:127–141`, file SHA256 `f81c427325e8ecdb9380038ebad994def06004f1a67cd6b7718247e090b632db` |
| First-43 CHECK capture | `scripts/sql/canonical-auth-provisioning-legacy-admission.sql:73`, file SHA256 `164298b223d28d7fb28cb0d96189892da2dbbca04dc354ae39302ed58645afa5` |
| Approved restoration | `supabase/migrations/20260910140053_canonical_auth_provisioning_legacy_boundary.sql:31–37`, file SHA256 `fcc6594b1b312e139ac094b811fee9395ee6ab780144d14d1c19e0c178a28983` |

The seven preserved values are `invite_sent`, `password_reset_sent`, `confirmation_sent`, `email_confirmed`, `password_updated`, `auth_callback_completed` and `auth_callback_failed`. The candidate adds exactly `email_action_verified`, `company_invitation_accepted`, `direct_user_created` and `direct_user_linked`, as authored by May20. The first three are active `AuthEmailEventType` literals passed through `recordAuthEmailEvent` with `action: input.eventType`; under the retained seven-value CHECK they are rejected with 23514. Password reset remains `password_reset_sent`. `direct_user_linked` is retained source intent, not a claim of an exercised active userSync caller. No status-domain change is included.

## Narrow candidate

`scripts/sql/forward-candidates/expand-auth-email-event-action-domain.sql`, SHA256 `69b8d5693f586209f37950be866e3f3dd8e5d910408c34ed9cb075daab85407c`, changes only the exact named action CHECK. It locks the ordinary, non-inherited public table and admits only the observed text/NOT NULL/no-default action shape, enabled non-forced RLS, and the exact validated local seven-value CHECK or its exact eleven-value repeat state. An unknown CHECK/domain, second action CHECK, constraint comment or unexpected table/column shape fails closed. The table name, rows, fields, other constraints, policies and ACLs are preserved. Repeating an already corrected constraint performs no replacement.

The expected eleven-value full row hash is `5ab97b0ac733079b2dae75003e1170fb9241278586b4b3db4da497f0255f6a08`, derived from the exact source values and comparator row format. Actual PG17 deparsing must match it in qualification. Neither the historical May20 migration nor the approved September restoration is altered.

## Qualification and remaining bounds

The fixed local PG17 fixture uses the previously reviewed nonce/owner-bound disposable database helper, rejects arbitrary database/SQL options and refuses a preexisting database. It captures catalog/rows privately and emits only a finite receipt. Candidate admission requires four exact source pins and exact candidate bytes. Its execution checks:

- All four additions fail with 23514 before repair; all eleven source values succeed afterward through the synthetic service role.
- Invalid action remains 23514, NULL remains 23502, and authenticated INSERT remains 42501 under synthetic deny-all RLS.
- The only permitted catalog delta is the selected CHECK's new OID and parsed expression. Its remaining metadata, all other captured constraints, columns/defaults, role memberships, ACLs, policies, routines, triggers, indexes and seeded rows remain equal. An outside table and a same-named control-schema relation remain unchanged.
- Eleven table/column/CHECK shape controls reject with 55000, an injected post-DDL failure rolls the entire candidate back, and repeat execution preserves the new CHECK identity.
- Service INSERT/UPDATE/DELETE run in a rolled-back transaction, and the owned database is disposed before success is printed.

Four offline tests pass for pinned selection, private target-option rejection, candidate/symlink rejection and a strict delta oracle with unrelated-change/incorrect-domain negatives. The corrected actual-module suite has 16 passing tests and explicitly reproduces three active 23514 failures under seven while accepting them under the intended eleven-value mock. Neither test result claims actual PostgreSQL execution.

`.github/workflows/gridex-auth-email-action-domain-qualification.yml` will run the actual fixed PG17 fixture, require its closed success receipt, then use pinned Supabase CLI 2.101.0 `migration new` in a fresh temporary workdir. It uploads unchanged candidate bytes under that genuinely created filename, exact SHA and source-head receipt. This is a qualified staged candidate, not automatic source selection or schema acceptance.

The fixture uses synthetic RLS policies and a minimal action/event table. It does not execute the full auth schema, actual authorization helpers, provider delivery, every CHECK/FK combination or a production deployment. Full reconstructed-schema application behavior remains a separate gate after promotion. Older deployed schemas lacking action retain the preexisting compatibility handling; no durable logging claim is made for them.
