# Independent current-main integration review two

Verdict: no confirmed introduced P1/P2 in this bounded integration delta. Approval is SOURCE ONLY and applies to merge `4696c1815a4a5f0337cb4b8dc27c213a437494af`, tree `3351298eab362b76f9adb396fe857a3da34e4d18`.

Workspace: `/tmp/gridex-ops-final`. Actual merge parents are reviewed branch `b4146a58e0a571ea04dd7537a2e50cce68c9764d` and current main `573d74371086da585a5cff6abee95eadfe58899e`. Git status contained audit/checkpoint changes only; every compared application, routing and GEN working-tree file was byte-identical to this HEAD. No merge conflict marker or unresolved index conflict was introduced.

## Actual integration delta

The complete app/lib delta against main contains exactly these five files:
- `app/api/v1/events/route.ts`
- `lib/integrations/apiResponseProfile.ts`
- `lib/integrations/webhooks.ts`
- `lib/staff-api/identityResolution.ts`
- `lib/staff-api/onboarding.ts`

I read their actual diff against main and relevant complete source boundaries. All five merged postimages are byte-identical to the prior reviewed b414 source. The integration therefore introduces no third application implementation or manual combination of these handlers.

The three API/event-profile changes preserve the existing credential/tenant authority while formatting the outgoing Website representation: declared wire markers are projected; Website pins come from credential metadata; immutable original publication evidence is restored through exact source identity rather than current publications; representation precedes request-body hashing and signing; an already attempted delivery refuses a different body/hash; Partner and event-list publication-token handling remain separate. The incoming SC031 Ediel code does not change these five files or their unchanged authentication/projection dependencies in this merge.

The two Staff changes allocate one server request ID and pass it to response formatting and existing request-log calls. Method/project/auth/binding/native-command checks are unchanged by the merge. These exact Staff hashes match the earlier independent source review, so its request-ID conclusions remain applicable; it did not certify logging of every unauthenticated rejection or live onboarding delivery.

## Incoming main preserved

The only incoming app/lib changes against b414 are `lib/ediel/inboundCases.ts` and `lib/ediel/rulebook/canonicalEdielFacade.ts`. I read that delta. It adds the main-owned bounded incoming-wire business-projection exclusions for end-user/installation groups and scalar fields, retaining raw/register evidence and using the canonical rule helper plus subtype/parent checks. The merge preserves these files byte for byte from main573; the API branch does not replace the SC031 behavior with its older inbound parser. This is an integration-preservation conclusion, not a new standalone certification of every SC031 native effect.

All five canonical GEN files listed below are imported byte for byte from main573. The new `20261014011520_ediel_sc031_source_owned_business_projection.sql` source and incoming producer/CI updates belong to main, and this review did not generate or modify them.

## Reviewed API/Staff postimages

| File | SHA-256 | Compared with |
| --- | --- | --- |
| `app/api/v1/events/route.ts` | `2890aa9e3bd27efe3052afdae43581bba38890aeb0ec83493ed81b4ef80bf61a` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `lib/integrations/apiResponseProfile.ts` | `4c4193c762d0b739e11b2ade02e7dbc2a8bc2550b2d903322a481d620144ef75` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `lib/integrations/webhooks.ts` | `8b2e68bfa5b4993fe29c7aaf8254603e0132d73c84df1efb9248b544f344ccbb` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `lib/staff-api/identityResolution.ts` | `e05e23dbeac7b535b4f1ed48e42a5333312edbff054d9218c8904e120a1b8dcc` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `lib/staff-api/onboarding.ts` | `0d6e9d6731b164b214d09e7e66c9c4ec5d291320be1706456551cd1285c9b84a` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |

## Reviewed routing postimages

| File | SHA-256 | Compared with |
| --- | --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `7c2ab100784fe3aab8ee8a350254e272adbfb96aad04f2a61d199a5d7cc0c8cb` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `scripts/gridex-ediel-history-union-inputs.py` | `4005c1ad9d0b52596e4f5bc52e009c68cbfc3d923f9ffe5e7d844c58f45d5750` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `1e8a946ce627f8e5705c0c33cbafc715ce5de15128805ab444908296ee0bdc49` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `scripts/gridex-derived-replay-inputs.py` | `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `scripts/gridex-ediel-upgrade-inputs.py` | `2286b227e967c9686c7e0541397c2fcb5814de5e1a02c5d5286bd17314e3c5de` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `supabase/bootstrap/20261013_ops_quote_nonexpiring_replay_adapter.sql` | `3afea47b4343c5d5e6d97a4f709bccf5c8cf6f7cf33c179f022629ff4d7c481b` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `supabase/bootstrap/20261013_ops_current_permission_replay_adapter.sql` | `d5e7d62982719ffea9ff0ca65149ca6b93e5e07e5caa3518f4e651c6688328f8` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |
| `supabase/bootstrap/20261013_ops_auth_expiry_replay_adapter.sql` | `070b2e524b964c78e9e99a91553f8d4eab74811fb8a76e994cfe8e52088b84fa` | reviewed `b4146a58e0a571ea04dd7537a2e50cce68c9764d`; byte-identical |

## Incoming main Ediel postimages

| File | SHA-256 | Compared with |
| --- | --- | --- |
| `lib/ediel/inboundCases.ts` | `997babcc935baba84c63a6ab845345f59dd627f2ece8992e33d199331bcee015` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |
| `lib/ediel/rulebook/canonicalEdielFacade.ts` | `f979775551293c9221d3cecff8fb51ae8b17f02dff99ee4222ae8dff0ed32d86` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |

## Imported main GEN files

| File | SHA-256 | Compared with |
| --- | --- | --- |
| `scripts/migration-history-manifest.json` | `87dc7fba4c2acd0cfd61860c457a3c3b84359289bac8e5376cc10c4b9ac9884e` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |
| `scripts/supabase-types-manifest.json` | `a3535251a4d836bd76d4c0dbdafa958bd9a8aa7a717aa00bf1245443b731c160` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |
| `supabase/database.types.ts` | `8fbaf566c956192d9b64a2e504d764c7e8497b9261ac19a413479bb6c675f9f2` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |
| `supabase/schema.fingerprint.json` | `39feaeeca7737b301b7369a1a1b6c9d00e4ffc4fcbc603948b66facf3cfa80ac` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |
| `supabase/schema.sql` | `ef8ade13f0876631c1c28fe228ac0f17588fae9b2026a951a2a44a51a64ecaeb` | main `573d74371086da585a5cff6abee95eadfe58899e`; byte-identical |

## Prior evidence applicability

All eight routing postimages remain byte-identical to b414, including the three exact derived replay adapters and their bounded additions descriptors. Their existing finite source approvals remain applicable to those exact files; the original historical source/artifact pairs and fail-closed routing logic have not been changed by the integration.

The existing `eight-file-committed-materialization.json` expressly qualifies b414 before the main573 merge. Its 605 upgrade / 363 history-union actual-file counts and preserved-source/hash observations are pre-merge source-input materialization evidence only. Current main contributes a new SC031 migration and incoming GEN/manifests, so that receipt is not a current whole selected-input, SQL replay, native schema/type capture or complete-CI PASS at4696. Byte preservation of the eight routing files cannot extend the receipt to all newly selected inputs.

The parent reports fresh production OPS main573 as READY, app typecheck PASS and migration integrity PASS. Those observations are not independently rerun or recollected here and are not promoted to proof for the complete merged SQL/GEN state. This report preserves main's generated bytes and the reviewed branch's application postimages, while leaving current whole-source qualification with its existing owner/lane.

## Work performed and limits

Evidence: exact HEAD/parents/tree/status, actual scoped source diffs, relevant handler/callee reads, Git blob comparisons and SHA-256 of the twenty listed postimages. All twenty reference comparisons and working-tree/HEAD comparisons matched.

No tests, typechecks, CI, native SQL, business RPCs, provider calls, migration applications, canonical captures, GEN work, commits, ref updates or project source edits were performed by this reviewer. Only this private report was written. Rebind this bounded review if any of these source bytes change.

