# Empty-platform default privilege correction — 2026-09-14

Status: implemented, offline controls verified; native confirmation and complete
replay/release acceptance are pending. No hosted database change or main merge.

## Evidence and bounded change

Source baseline: 5b934308249dde2f51cf4d71c4a216ae5479e142 (PR310).
The independent official CLI 2.101.0 lifecycle run34825611574 used image
public.ecr.aws/supabase/postgres:17.6.1.106. Its real initialization grants the
postgres-created public tables, sequences and functions to anon, authenticated
and service_role. Artifact10340451906 ZIP SHA256:
cfeee46cac93f39e387399d43e402377198140075cf28e60017cb703e33217e0.

The old portable bootstrap omitted initial table and sequence default privileges.
This differs from native initialization before any Gridex history executes.
20260902094000_platform_table_classification_and_invariant_gate.sql makes tenant
classification depend on effective client grants. Incorrect initialization can
therefore change later RLS, policy and composite-key creation. This report does
not attribute all current reference differences to that one cause.

Only the bootstrap public-default block changes. All historical migrations,
reference dump/fingerprint, generated types and their acceptance manifest are
unchanged. Later historical revocations remain authoritative. Current live,
already-hardened defaults are NOT used as fresh-platform defaults and are NOT
modified. No grant is applied to any hosted table.

Old bootstrap SHA256:
41cc610b7cfa8a7c894c5433a5593607028ad85e885db64b1d094abb486dd391.
New bootstrap SHA256:
d7d6d7b7f1a55cff7fad78ca6397aa5d4e8d43ea1d1ec362eca741bcc36b403b.
Two source-admission manifests are rebound to this exact test-platform input;
source/admission rejection tests still pass.

## New native positive and negative control

The existing owned/unlinked CLI lifecycle now tests its native database against
two new template0 databases in the same owned, internally networked container.
The old complete bootstrap is reconstructed and hash-verified byte-for-byte as
the negative control. The corrected complete bootstrap is the positive control.
Synthetic probes compare48 effective table/sequence/function grants, RLS flags,
function security mode and PUBLIC function access. The old bootstrap must show
exactly33 missing client/service grants and no other metadata difference; the
corrected one must match native. No override or observed-result rebaseline.

Every probe and secondary database is owned, collision-protected and cleaned.
A mismatch stops before the lifecycle's genuine CLI migration proof and still
performs cleanup. Neither real Gridex data nor a hosted project is addressed.
The native test receipt explicitly keeps fullReplayAccepted=false.

## Offline verification

Red: original bootstrap fails the new source-default assertion.
Green:13 bootstrap controls,15 lifecycle/CLI controls,21 permission source
admission tests,10 permission fixture tests,11 permission runner tests,
20 replay cleanup controls and23 independent-reference controls passed locally.
Permission fixture construction:129 cases/1128 assertions; construction only,
NOT native case execution. Migration integrity remains601 files/505 groups.

## Release boundary

Native requalification, selected whole-chain SQL execution, independent schema
comparison, the ordinary native Supabase replay/real ledger and generated types
must still pass. A green synthetic lifecycle alone cannot certify those steps.
Main merge remains conditional on every mandatory check for the exact head.
