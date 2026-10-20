# Supply deadline runtime repair

This repair addresses a confirmed production schema gap. The scheduled
`supplyMarketDeadlines` step returned `PGRST202`: its RPC was absent even though
the source, generated types and cron consumer expected it. The reason for the
partial installation is not established.

## Exact change

Forward migration `20261018230141_restore_supply_deadline_runtime.sql` restores
the public deadline command, its private predecessor and the private sweep
cursor. It preserves the latest regulated graph/current-ground checks from
`20261001004331`, rather than the older September helper. Existing activation
implementations, source/confirmation/activation ledgers and business rows are
neither replaced nor invoked by installation.

The public command verifies an active actor and accepted active membership
with `metering.write` before helper or cursor work. Normal activation candidates
are filtered to that actor's companies. Cursor scope includes the actor to keep
one actor's scan independent from another actor's permissions. Each ending,
regulated-start and normal-start phase independently clamps its limit to
1–200; this is not a combined 200-row limit. Held normal candidates roll back
their activation attempt and advance the scan so another eligible candidate
can proceed. Existing authoritative activation checks remain in force.

Only `service_role` can execute the public command. The helper and cursor are
private; the cursor has RLS and no direct service/anonymous/authenticated table
grants. The runtime diagnostic now checks the required relations, functions,
67 used columns, compatible cursor nullability/defaults, a usable immediate primary-key arbiter,
ordinary non-generated columns and role boundaries. Extra unique/exclusion
arbiters, custom constraints, user triggers and rules fail qualification.
The diagnostic remains SECURITY INVOKER and resolves object OIDs through
pg_catalog, so it needs no access to the private schemas. Real service-role
execution is included in the regression. Existing diagnostic checks remain.

Website checkout additionally consumes both the runtime diagnostic and the
complete automation-readiness result. Missing, false or unavailable readiness
keeps checkout closed with controlled database/automation blockers. An otherwise
qualified read-only customer portal remains available. No private function name,
storage path or raw database error needs to be exposed in the public API.

## Qualified rollout

The existing qualified database/schema producer and serial delivery owner retain
their roles. Source reservation or local SQL tests do not appoint a replacement.

1. Confirm exact source, receiving main, two independent final reports and
   applicable mandatory checks. Register the forward checksum and obtain genuine
   schema/types/fingerprint outputs in the incumbent producer's qualified turn.
2. Re-run the bounded catalog preflight against the actual target: required
   columns/functions, owners, ACLs and current function bodies. The observed
   target had all required base columns, graph/ground guards and activation
   implementations; only the three named objects were absent. Preserve existing
   stronger activation bodies and source/retention guards.
3. Apply the forward atomically. It uses finite lock/statement timeouts and an
   advisory transaction lock. Unexpected existing helper, wrapper or diagnostic
   bodies, cursor columns/key or missing prerequisites abort the transaction.
   Never remove a conflict guard to force installation. The expected existing
   or repaired definitions are accepted, so a qualified repeat is idempotent.
4. Wait for the transactional PostgREST schema-reload notification, then call
   the read-only runtime diagnostic. Verify every expected check, role boundary
   and source binding. Verify that installation did not invoke market commands
   or change business rows.
5. Publish the qualified receiving code through normal delivery. Observe the
   existing scheduled cron and its actual deadline step result. A catalog pass
   alone is not an execution proof. Use the approved test company/customer for
   any additional controlled effects; do not create another signed agreement.
6. Re-read `/api/v1/integration/context` through its real authenticated boundary.
   A missing runtime prerequisite must make checkout readiness false. Restore
   the prerequisite through qualified schema work before declaring it ready.

## Verification and limits

`__tests__/supply-deadline-readiness.test.ts` invokes the real readiness evaluator
and awaits `verifySupplyDeadlineRuntimeRepair()` from the mechanical SQL driver.
The driver uses actual PostgreSQL semantics with declared external permission,
regulated-ground and legacy-activation fixture ports. It asserts ACLs, missing
prerequisites, actor/company rejection, bounded ending effects, source hash and
version binding, held-candidate rollback/progression, regulated-ground refusal,
idempotence and conflicting-definition refusal. It performs no production write.

These source tests are not native issuer/market acceptance or a live cron
qualification. Fullmakts-PDF archiving and the corresponding external API
supplement remain separately tracked with PR828. A system verification reference
does not claim provider-verified BankID or a PDF cryptographic signature.
