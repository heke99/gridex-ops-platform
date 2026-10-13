# OPS atomic installation: concrete capability block

The approved 6,628,349-byte semantic source (`bacf8944718c984d117f0400ed19fadd978feed6613ea9196784eff4591ac600`) and all 51 registered source-byte parts remain unchanged. The semantic installation has not been applied. The three connector responses requesting authentication do not establish a PostgreSQL timeout or the exact underlying connector failure. No FATAL/PANIC/crash/42501/28000/57014 was found in the bounded official log windows. Actual catalog evidence independently establishes the privilege gaps below.

## Required protected-owner operations

These are proposals, not executed operations or ordinary migrations executable as the connected `postgres`:

1. `001-protected-auth-schema-usage.sql`: authorized principal acting as the existing `auth` schema owner `supabase_admin` grants **USAGE ON SCHEMA auth TO gridex_ediel_retention_owner**, without grant option.
2. `002-protected-auth-users-select-update.sql`: authorized principal acting as the existing `auth.users` owner `supabase_auth_admin` grants **SELECT, UPDATE ON TABLE auth.users TO gridex_ediel_retention_owner**, without grant option.

The ordinary project `postgres` and `dashboard_user` cannot grant the missing schema USAGE or table UPDATE privileges. `postgres` has no MEMBER/SET/USAGE capability for either protected owner. This packet does not obtain credentials, alter system memberships, create a privileged bridge, or assume that a user SQL editor provides these owners. If an authorized protected-owner connection is unavailable, these exact operations require the platform owner's execution. Existing user authorization for database fixes cannot supply a missing database capability.

No direct `auth.uid()` grant is required: the retention owner already has effective EXECUTE via PUBLIC. The approved semantic source's original Auth grants remain byte-identical. Its original storage grants are executable through the current installer's actual grant options.

The owner proposals guard the actual owners, preserve every non-retention ACL entry, refuse additional retention privileges or grant options, and recognize exactly the sealed NOLOGIN/NOINHERIT/BYPASSRLS owner and its sole existing pure-read function. Fresh actual metadata at 2026-10-13 16:02:57 UTC proves that function is `public.ediel_customer_record_tombstones_v1(uuid,uuid)`, service-role-only, body MD5 `7eb808f1f5414538379c60edd4a2d68e`; its body only locks a company-scoped customer and reads tombstone metadata. It does not call Auth or erase records. No existing retention-owned erasure function exists. All anon/authenticated/service_role/authenticator MEMBER, SET and USAGE capabilities for the retention owner are false. Thus the prerequisite grants do not activate an existing weak erasure route; unknown new owner functions or role memberships make the proposals refuse execution.

## Qualified ordinary-installer operation

`003-qualified-atomic-install.sql` preserves every prior transport/source hash, each part and the executable semantic byte string. It adds:

- A failclosed check for the retention owner's effective Auth USAGE, users SELECT/UPDATE and uid EXECUTE before semantic DDL.
- Exact recognition of the two existing retention memberships of ordinary NOSUPER `postgres`: supabase_admin-granted ADMIN=true/INHERIT=false/SET=false and postgres-granted ADMIN=false/INHERIT=false/SET=true.
- Exact prior recognition of the existing owner-only retention schema and four table ACLs, with no column ACLs; unknown prior grants refuse rather than being silently preserved as qualified state.
- Exact protected Auth ACL recognition before and after execution: unchanged non-retention entries, protected-owner USAGE and SELECT/UPDATE without grant option, and only the explicitly source-qualified optional SELECT grant from postgres or EXECUTE grant from the Auth function owner.
- A transaction-scoped change to INHERIT=true only on the already existing postgres-granted controlled-owner membership. It creates no system memberships and changes no role flags, app memberships, table or schema grants.
- Execution of the unchanged approved byte string, followed by INHERIT=false restoration and exact comparison of the full membership rows, including OIDs/options/grantors, role metadata, and original retention schema/table/column ACLs before commit.

Inheritance supplies owner authority for the existing private schema, immutable global catalog insert, two old-parent REFERENCES, and new objects' ownership/ACL phase. Any refusal or failure rolls back both the semantic installation and temporary capability change. The original private transport table/schema cleanup remains RESTRICT-only and atomic.

The source's two namespace-ACL structural probes cover its 50 new schemas. The existing retention namespace is outside that set. The approved source does not inspect pg_auth_members or change existing membership-edge options; its retention role flags and application-membership manifest remain unchanged.

## Qualification boundary

All four proposed SQL/PLpgSQL units parse with pglast 7.7. Both independent reviewers have cleared their bounded source/security composition. Genuine PG17.6/PostGIS3.3.7 qualification is complete under a direct NOSUPER postgres connection after the exact protected-owner prerequisites and actual Storage grant options are established in the isolated fixture. The owner prerequisites, main installer and all six subsequent inputs commit on first execution and replay. The main installer also commits after restaging its identical 52 transport units following the complete six-input sequence, preserving the entire strengthened semantic catalog. Fourteen wrong-owner, unknown-metadata and forced-failure cases refuse and roll back. Complete original role metadata, both membership OIDs/options/grantors, old retention schema/table/column ACLs and RLS, and the original tombstones function remain unchanged; effective post-install retention Auth and Storage rights are verified. Earlier stronger bootstrap compilation alone did not prove ordinary-installer capability.

The complete receipt is `/tmp/gridex-api-review/installer-nonsuper-final-pipeline-isolated-compile-receipt.json`, SHA256 `541e238e93ff6fee64206abe51d11494f19a844f2f57051943bdf98360cbee1e`. This is isolated catalog/engine qualification, not a business lifecycle or full historical replay certification. No actual writes, business calls, business rows, secrets, or generator captures were performed for this packet.

All four proposals are **NOT_APPLIED**. Final actual read-only capture at 2026-10-13 16:56:28 UTC confirms all 51 source parts and the full approved SHA remain intact, with no module relation, origins relation or final atomic migration registration. The retention owner still lacks all three required Auth rights; postgres still lacks the missing grant options and cannot SET either protected owner. The external execution capability is unavailable through the current project connection. No renewed user permission is needed; the exact protected owners must supply the two authorized operations.

## Subsequent source inputs and installer context

After the main installer, apply the exact inputs in `pending-semantic-execution-map.json`: Part1 `d821d77e…`, Part2 `edcd6154…`, Z02 `1e6af520…`, protected triggers `5feebfef…`, controlled retention wrapper `2ff105e0…`, then metadata assertion `5aa1fd4f…`. The five ordinary inputs replace or create postgres-owned objects or assert metadata; their direct ordinary-installer execution is now qualified.

`004-qualified-retention-install.sql` embeds the immutable 43,134-byte retention source `19624482d3a4df867e999848e8b7b8ed72f9c8f2b4962ebb3c75b369c937d4ad`. Only its outer BEGIN and COMMIT ranges are removed, yielding 43,119 executable bytes SHA256 `418eb6adde3491d12a06a518cc1807c17ca8e49ad90c698187d0bff18a7310df`. The envelope temporarily enables the same already-authorized controlled-owner edge and grants CREATE on public to the retention owner for its new public helper ownership. It keeps those exact capabilities for the complete immutable source DO, then restores both memberships and schema privileges before commit, comparing complete original rows/OIDs/options/grantors/role metadata/schema ACLs and every pre-existing retention relation/column ACL. New source-owned origin-table/index objects are explicitly distinguished from the original OID set. The original retention source, public helper bodies, application grants and RLS remain unchanged. This envelope is separately source-reviewed and genuinely qualified on first execution, replay and forced rollback.
