# Actual installed lease source — native fixture correction

Authentic OPS run `36797136173`, clean job `110163040979`, requested head
`86acc5d6`, executed **13 PASS / 1 FAIL** of the 14 residual queue/budget native
cases. The failed case was the current-row approved-invoice lease CAS fixture:
`readFileSync` could not find the forward migration because clean replay had
already moved candidate migrations into HOLD. The production CAS assertion in
that case had not run. This is not a production scheduler failure or a 14/14
native acceptance receipt.

The fixture now reads the exact qualified installed function with
`pg_get_functiondef('private.gridex_claim_partner_queue_fair_v1(text,uuid,integer,uuid,text[],integer)'::regprocedure)`.
It extracts and executes the same production lease UPSERT fragment as before.
The fresh competitor token, zero returned lease IDs, public claim exclusion
and exact two-hour cutoff assertions are unchanged. No production SQL or
history/HOLD behavior changes.

The unique local actual PostgreSQL-core proof reproduced the old source getter
gap (RED), then passed **1/1 GREEN** using the actual installed function body and
its current-row CAS. It verifies that neither a fresh unfinished competing
token nor an unfinished lease exactly at the cutoff can be replaced. This is a
bounded PostgreSQL-core receipt; the repaired native case requires a genuine
CI rerun. No local native execution is claimed.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/residual-applied-lease-source-20261001.postgres.test.cjs
```
