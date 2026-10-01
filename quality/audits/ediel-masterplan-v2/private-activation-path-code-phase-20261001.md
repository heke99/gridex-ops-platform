# Private source activation path — code phase 2026-10-01

The 201111 source-owner migration moved the actual 20260725120000 activation implementation into `gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)`. The body already qualifies its public relations and row types, but retained `SECURITY DEFINER search_path=public`. This was a genuine current strict private-owner security finding, separate from missing verification.

Forward CLI migration `20261001053742_ediel_private_supply_activation_search_path.sql` checks the exact real signature, definer and all consumed relation qualifications, then alters only its search path to `pg_catalog`. It preserves the body, OID, owner, ACL, real activation effects, public guarded caller and #422 ABI. Older migrations and security criteria remain unchanged.

11 targeted PGlite mechanics of the actual moved body passed: path corrected; body/OID/owner/ACL/definer unchanged; real argument gate still executes; service cannot call private helper directly; repeated forward application preserves metadata; an unqualified altered body fails closed. Two statements parsed with pglast and diff check passed. Independent authority-owner bounded review found no open Critical/Important in this literal delta and did not rerun these mechanics.

Whole activation/native replay, schema/migration replay, broader security and candidate-SHA test phase remain unrun. This packet supplies code and scoped evidence, without PASSED or production activation claims.
