# Independent current-main integration delta source review

Read-only review 2026-10-14 of actual merge `4696c1815a4a5f0337cb4b8dc27c213a437494af`, tree `3351298eab362b76f9adb396fe857a3da34e4d18`. Exact ordered parents from `git show`: reviewed API/routing parent `b4146a58e0a571ea04dd7537a2e50cce68c9764d`, then actual main `573d74371086da585a5cff6abee95eadfe58899e`. Both direct parents are ancestors. This review is confined to their new integration delta; unchanged final source reviews are reused rather than repeated.

## Conclusion

No new runtime/document/source-routing integration defect found in this bounded merge delta. The incoming main Ediel files are preserved exactly; all eight previously reviewed routing files and all five API runtime postimages are preserved from b414 exactly. There is no newly composed runtime edit. This is source applicability only, not full SQL schema/type qualification, native/CI PASS, or delivery approval.

## Exact evidence

`git diff --name-status main573 merge4696 -- lib app` contains precisely these five runtime files:

- `app/api/v1/events/route.ts`
- `lib/integrations/apiResponseProfile.ts`
- `lib/integrations/webhooks.ts`
- `lib/staff-api/identityResolution.ts`
- `lib/staff-api/onboarding.ts`

`git diff --exit-code b414 merge4696 --` those five files, eight routing files and relevant Staff/API documentation returns empty. Existing source review conclusions for these identical postimages retain their original bounded scope.

`git diff --exit-code main573 merge4696 -- lib/ediel/inboundCases.ts lib/ediel/rulebook/canonicalEdielFacade.ts` returns empty. Exact merged blobs:

| Incoming main source | Merged blob |
| --- | --- |
| `lib/ediel/inboundCases.ts` | `ce971ecc671d6a4aeac8a148ebd283780bce4f04` |
| `lib/ediel/rulebook/canonicalEdielFacade.ts` | `6012241de1210e35b50b55fa646e92930b8f330c` |

The eight unchanged b414 routing postimages:

| Routing source | Merged blob |
| --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `f75637bb73337b0d777a2fedb1047e45a9c6b000` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `f5ec18fa249a39217263ff177c481d7d68b23402` |
| `scripts/gridex-derived-replay-inputs.py` | `75d02263d79a86bb16ebb4759cab74946c9b6788` |
| `scripts/gridex-ediel-upgrade-inputs.py` | `97ca8d25f3f701a2d53e24052fda1c8a78b4aa06` |
| `scripts/gridex-ediel-history-union-inputs.py` | `b3e2be6b65fede7f5c6e692dd43a9dbfb1f48adc` |
| `supabase/bootstrap/20261013_ops_quote_nonexpiring_replay_adapter.sql` | `551cd07653356b3bca7c75981f0e3e344e4acdfd` |
| `supabase/bootstrap/20261013_ops_current_permission_replay_adapter.sql` | `b0e9332d2792949e2220349751160973849fb079` |
| `supabase/bootstrap/20261013_ops_auth_expiry_replay_adapter.sql` | `9e86df2e01c4cf4b13d68cf2d76ec97cd5d6087b` |

## Integration reasoning

Incoming main changes only Ediel inbound national-extra business projection, its canonical exclusion helper, SC031 private SQL guard/schema representation and producer/test/workflow metadata. The unchanged API profile/event/webhook paths have no imports/calls to those Ediel TS modules. Added Staff paths likewise use unchanged Staff authority/Auth/storage/tenant helpers, with onboarding RPCs `gridex_lookup_pending_staff_identity_binding_v1` and `gridex_accept_external_staff_invitation_v1`; neither invokes the Ediel business parser or private object-batch projection path. Relevant integration/customer-portal/event/Staff directory search shows no such Ediel module dependency.

Prior bounded changed-main review already traced the private SQL relation: Ediel-specific `canonical_onboard_customer_graph` object channel reaches `gridex_prodat_object_batch.onboard_v1`; the assigned API event paths do not use that channel. Main573 does not change that onboard function or the five functions targeted by current-permission or Auth-expiry adapters. Incoming SC031 migration timestamp20261014011520 is outside each of the three adapters' source-bound open execution brackets, so it does not change their sole-source chronological eligibility. No API contract schema/registry, public webhook registry, Staff identity policy or documentation was changed by the incoming merge delta.

Documentation remains the b414 postimage. Main573 adds no competing Staff/API documentation edits requiring reconciliation. The exact preserved docs comparison includes API index, Staff API, independent onboarding, support123 integration and tenant invitation delivery.

## Boundaries and outstanding qualification

The repository's canonical SQL/schema fingerprints and source manifests do gain the main573 SC031 source. Therefore whole SQL replay/schema/type evidence from premerge b414 does not qualify merge4696. Existing exact-file source review reuse is distinct from new whole-source proof. Root's typecheck and current native/GEN/CI work remain outside this review; no outcome is inferred for them. Reported production main573 is parent context, not a new database observation made by this reviewer.

No source/shared changes, ownership claims, producer activity, tests, GEN, native/database calls, network, CI reruns, ref edits or publication were performed. Only this private report was written. Current parent custody is respected; Git preservation evidence does not independently attest the complete claim protocol. Source readiness remains bounded to exact merge4696/tree3351298e and the observed unchanged-file reuse.
