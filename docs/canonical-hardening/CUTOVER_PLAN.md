# Cutover plan

Current decision: **NO-GO**

Promotion prerequisites:

- ledger and schema parity signed off;
- all new migrations applied successfully in staging;
- zero ambiguous tenant rows or an approved quarantine that removes them from active paths;
- zero duplicate active profiles;
- canonical readiness is the only prepared/live gate;
- real JWT RLS matrix passes for tenant A, tenant B, owner, company admin, platform admin, anon and service role;
- same-key/same-payload and same-key/different-payload concurrency tests pass;
- worker claim and pre-transport pause tests pass;
- external test transport proves `prepared`/`queued` never equals `sent`.

Cutover order: pause workers → apply migrations → validate → deploy application → smoke test → resume test workers → resume production workers tenant by tenant.
