# S2 staff client authority

Isolated base: `363c92490`. CLI created forward migration
`20261004094344_staff_user_client_guard.sql`; historical migrations are unchanged.
Only the client block in the existing private `gridex_assert_staff_command_v1`
changes. OPS commands retain their existing behavior.

After the company lock and actor authorization, the guard locks the exact-company
client with FOR SHARE, checks active/nondeleted/nonrevoked/nonexpired state and the
explicit `staff_users.write` scope, then recalculates actor permissions after any
client lock wait. These checks precede the existing cached replay return. The guard
stays private to the canonical SECURITY DEFINER entrypoints; no ACLs are broadened.

Verification uses actual canonical role mapping, v2/unchecked access commands,
invitation commands and the canonical cache hash trigger. The original guard
returned cached access/invitation results for revoked, deleted and expired clients:
three behavior tests failed before the repair. After repair, 12 new tests and the
12 adjacent native policy tests passed (24 total), including new writes, both cache
paths, OPS compatibility and execution ACLs. The complete rollback SQL regression
also passed on embedded PostgreSQL with that actual command chain. Scoped ESLint
and diff whitespace checks passed.

Supabase, Postgres lock/privilege guidance and verification-before-completion apply
as in the preceding shared write guard repair. Root owns memory, migration checksum
registration, native CI wiring and generated artifacts. Embedded execution does not
qualify native row locking or the complete Supabase schema. Run
`scripts/staff-user-client-guard-regression.sql` on the disposable native replay;
all its synthetic rows, business writes, receipts, outbox events and audits roll back.
No production action or real invitation was performed.
