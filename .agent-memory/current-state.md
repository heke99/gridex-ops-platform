# Current state

Updated: 2026-09-13.
Status: PARTIAL

## Active task

Database/types only: complete migration verification, ordinary replay/ledger,
then regenerate accepted types. PR310 remains draft/unmerged. No production reset,
main merge or deployment during these proofs; points85/86 are not complete.

## Published implementation and evidence

1f09dcc770215f1a64b895c2172bf7eec5fa2032 publishes exact reviewed tree
1ace7a02ab3e5e8e54e0abb385b9a5f9b2b08f14 through the connected GitHub API.
The temporary publisher and payload are removed. Its own GITHUB_TOKEN could not
publish workflow changes; no permissions, branch protections or gates were relaxed.

Canonical source dispositions now account for600 inputs:588 selected originals,
7 exact reviewed residuals and5 explicit exclusions, with0 unresolved inputs.
The original selector still reports588/2/5/5; input accounting is not proof of
successful SQL, surviving effects, managed schema, ledger or generated types.
Historical DB2 operator programs remain explicitly unexecuted.

Base6064dcf native34776030335/job103774181992 passed144 foundation,7 residuals
and513 timestamp stages in both selected and originals-absent staging lanes.
On1f09dcc, run34778949144 passes source admission and selected native continuation;
its actual owned-shell job103782281962 fails before source SQL, cleanup passes.

## Active correction

The owned-shell workflow used gridex-auth-legacy-ordinary, but AcceptedInputs
only admits fixed/continuation identities with numeric run/attempt suffixes.
The same FRESH_FIXED_PREPARATION_REQUIRED rejection is reproduced locally.
Change only the workflow identity to the already accepted continuation family;
keep the private-input guard unchanged. Three new constructor tests exercise
real identity/method/source admission without container or SQL execution.
All3 new tests,13 existing tail tests and18 source-admission tests pass locally.
This correction is IMPLEMENTED_NOT_VERIFIED until fresh native CI is read.

Evidence: quality/audits/DB_OWNED_WORKFLOW_IDENTITY_2026-09-13.md.
Next: inspect corrected actual owned-shell CI; repair its first genuine failure
without changing the accepted fingerprint to match an arbitrary diagnostic.
Then establish supported managed lifecycle and real ledger before accepted types.

## Preserved scope

No production mutation in this batch. The accessible Supabase default branch is
not disposable. App/API baseline52b2de4d81cae370bf250e5a80f12c300bbddd16 and paused
quality/paused/2026-09-12-partner-price-wip.patch are unchanged. After database:
recorded event_scope/DQ defects, RLS, billing, jobs including86, paused API, review.
