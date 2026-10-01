# Billing import outcome correction — continuation after local commit 97c81

Scope: only `app/admin/billing/import/actions.ts`, its existing page, and new
`__tests__/billing-import-action-outcome.test.ts`. The first eight billing files
remain unchanged. No provider call, database migration, native/hosted write,
communication, commit or publication was performed by this package.

Systematic debugging and test-driven development were applied to the actual
exported action; React best-practices review was applied to the owned page.

## Confirmed reproduction

The genuine parser and exported import action were executed with mocked database
and authority boundaries. The Next redirect mock throws its control-flow error.
Initial execution: **9 failed / 0 passed**.

- Successful persistence called `done(success)` inside `try`. Its redirect was
  caught as a failure, causing a second redirect with `NEXT_REDIRECT` as the notice.
- Row-log insertion and final batch update errors were ignored; the action still
  initiated a success response. An empty result without a query error was also
  accepted without a confirmed row or final state.
- A partial import and an all-failed import were not represented with their
  actual final outcome. Error details could escape to the notice or stored public
  row issue. The final batch update had no explicit company predicate.

## Change and authority

The terminal redirect runs outside catches. Every initial batch/underlay/row
creation must return its identity. Imported/failed counts advance only after the
corresponding row log is confirmed. The final batch update filters both original
batch ID and current company; its returned ID, status and counts must match.
Complete, partial and all-failed outcomes have distinct notices. A cache refresh
failure after confirmation cannot turn committed success into import failure.

One error formatter logs a redacted technical cause with a correlation reference
and returns a safe public message. Underlay errors saved in public row issues use
that same safe formatter. If a later write fails after underlays were saved, the
notice explicitly reports their existence and does not claim completion.

Current actor and permission-scoped company still come from the server guard.
The operational company must match the guard's company for nonplatform callers,
followed by the existing company-specific authority guard. Forged form tenant or
actor values cannot choose the import owner. The page disables upload, paste and
submission for a read-only actor and gives partial outcomes a visible warning.

The existing partial-import design remains nontransactional. A saved underlay can
exist when its row-log write subsequently fails. This package preserves that
work, reports an unconfirmed final result, and advises checking the last import
before retry. It does not promise atomic import, safe repeated submission,
idempotency or automatic recovery of an interrupted import.

## Verification and original requirements

Fresh Node 22.23.3 command: `vitest run
__tests__/billing-import-action-outcome.test.ts
__tests__/customer-import-billing-separation.test.ts` — **20/20 in 2 files**.
The new file has 17 cases, including real selected File content/name, initial and
final missing results, row/final failure, current actor/company, scope change,
actual final identity, retained partial work, postcommit refresh failure, direct
page/action binding and read-only controls. Owned ESLint: **0 errors/warnings**.
`git diff --check`: **PASS**. Integrated app/test typechecks are root-owned and
pending this changed candidate. No native importer or browser execution occurred.

| Original ID | Bounded evidence | Still required |
|---|---|---|
| U01/U02/U03 | Import family `OPS-FAMILY-8fdd036fe711e74a` maps page form/button to the genuine exported declaration and its new executable action cases | Final inventory reconciliation; other independent actions remain separate |
| U04/U05/U18 | Strict persisted result confirmation, one true notice, safe failures, partial warning and read-only tree assertions | Native persistence and real browser refresh/result |
| U09 | Existing server permission and company guard preserved; scope mismatch denies before any write; page controls disabled for read-only actor | Actual current session/SQL permissions and browser roles |
| U17 | Actual selected File content overrides unrelated pasted content, retains its name/source, and meets server authority checks | Real browser file selection/upload, limits and actual DB graph qualification; download/export handlers were only traced read-only |
| T01/T02/T08/T50 | Server-derived actor/company; explicit final tenant predicate; existing customer import billing/contact separation tests remain green | Exact native tenant/customer/site/meter graph and interrupted import qualification |
| U06/U11/U12/U20 | No acceptance claimed | Existing form still lacks browser-qualified pending/double-click protection, failure draft retention and navigation guard; full flow/screenshots remain pending |

Read-only review by OPS owner confirmed the bounded outcome correction and raised
the guard/operational company equality and returned batch identity checks; both
are now included. Actual native reachability of scope drift was not claimed.

## T17 continuation boundary

The current code still has no separate persisted decision for invoice redelivery
to a newly verified address. Sent/credited sender fences remain present. Customer
communication resend reuses a log's prior recipient and is not that financial
decision. This is a missing local capability; real provider delivery contract and
acknowledgement are additional external qualifications. The missing local path
must be resolved independently and cannot be described as credentials alone
blocking an otherwise implemented feature.
