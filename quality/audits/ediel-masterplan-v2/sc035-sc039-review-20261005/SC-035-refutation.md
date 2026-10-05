# Independent refutation of the SC-035 original-area suspicion

Baseline: main01b11f55. Reviewer: independent agent sc035_refutation, distinct from SC035 finding author. Root independently checked the frozen P10 condition and original source table field260: Z02 must carry the same grid area as its sent Z01. No runtime experiment was performed.

The source-level missing comparison survives. The effective public wrapper `20261001022917_ediel_z02_native_actor_and_source_authority.sql:10–58` delegates to the renamed `20260930164947` body; `20261001061731…sql:10–31` changes only search_path and requires the unchanged body hash. The snapshot has these definitions at schema.sql23831/49260. Delegate164947:128–162 compares parties, transport identities, object/agency/LI, subtype and customer. The snapshot fence163–168 compares address/grid owner;171–182 resolves incoming gridArea, later251/286 stores it. No originalZ01/incomingZ02 area equality predicate was found in those effective paths, legal/source/application gates or current TS/job consumers.

The broader overwrite allegation is refuted. The genuine geography BEFORE UPDATE trigger (`20260825112000_ops_precision_resolution_authority.sql:98–118`) rejects a changed geography with unchanged resolution binding when the core sets facility_verified. The reduced embedded fixture omits that trigger, so it cannot prove unrestricted production overwrite.

The surviving bounded candidate is sent immutable Z01 areaA; later legitimately resolved current site alreadyB; unchanged address/grid owner and unsuperseded request; incoming Z02 areaB with matching parties/object/customer/subtype/LI; B resolves to the current price area. The update leaves current geography unchanged, so that trigger does not itself enforce originalA=incomingB. This requires genuine consumer execution and source-owner adjudication. No production mutation, active supply, automatic Z03, vulnerability severity or whole-scenario contradiction is asserted from static reading.

Searches: all migrations and schema for effective Z02 definitions/aliases, inbound context derivation/readers, original/incoming area predicates, job correlation/freshness guards, site geography triggers/constraints, canonical field/application validation and TS consumers. The existing P10 SQL probe contrasts LI/customer only; absent supply/switch tables do not prove native forbidden effects. Root will verify these20 input hashes before publication.

```json
{
  "supabase/migrations/20260930164947_ediel_z02_original_dispatch_proof.sql": "f53ecc981b357c2423578a592702bc7291046a262d24bc7fc6b247693d0acd65",
  "supabase/migrations/20261001022917_ediel_z02_native_actor_and_source_authority.sql": "255f613a52aaf3fcd936dab53f5048479d11fa361ae090d0b64bd5bc6b6ee1c2",
  "supabase/migrations/20261001061731_ediel_private_source_alias_catalog_path.sql": "9c23d8ce815e3bf895920f9dcb9828e3aef13f6eb6d9843b12fd149d6a8aed90",
  "supabase/migrations/20260930173632_ediel_immutable_source_legal_context.sql": "98a186c75e6bef3c8b1609ae15a09679f4599a5452cb141089eff872d4494f13",
  "supabase/migrations/20260930180104_ediel_immutable_source_rule_pack_basis.sql": "bc3b3550a5f3a4b34344d4d5cac80d526ef7c6df504208d066fc58feab16c156",
  "supabase/migrations/20261001003657_ediel_received_err_application_response_authority.sql": "565204f3568b5b239d0997f50f9b947fd2b5fb500afb0864eb11409ebf3be173",
  "supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql": "839feb43b8b2f4bc2b9147e654a3150fe1ce3de3ade495b470a982132e4c5675",
  "supabase/migrations/20260825112000_ops_precision_resolution_authority.sql": "3f3549adffd87fcc1bd9d6811189734e57b2c6317442506f0f762bfcb84432d8",
  "supabase/migrations/20260903213000_z02_snapshot_market_context_guard.sql": "9ceaa0506831a7c2a10380eb4569ab38e26fc6919e9faf136d91e469d32f2300",
  "supabase/migrations/20260821165300_prodat_identity_and_z02_li_compliance.sql": "3fd8ba9493783bcd1ffd5e446a0911fdf9ec306a8054dde99eecbb6701d4d012",
  "supabase/migrations/20260903070000_harden_inbound_z02_required_payload_gate.sql": "cf8d81ac33d8687a817fba537791e25d89ccaf3f7ee342988ddb1dc0a9141d0b",
  "lib/customer-operations/automation.part-1.ts": "066d49d31a039750da695255dcf2a247191a425405d2dafa0b0b208661a17ea0",
  "lib/customer-operations/automation.part-2.ts": "5333edd4d72f8d721ca023cfc7d52ac5c89887ebe5708bb29caca4536163a756",
  "lib/customer-operations/z02AtomicEvidence.ts": "d6399fca17db11b53743996986bef87f6fbc852b96bf1944ea666334455dbc2f",
  "lib/onboarding/inboundEdielLinking.ts": "b323a5027388b4d99c2687860415443f218c7289921adfbbe8e23888c70df8ee",
  "lib/ediel/rulebook/canonicalPolicyFieldValidator.ts": "ac76e0e39f49e4b3ec0eed8dad1cc83214c9828b472d54b6a98eb0b3cd4fe3c3",
  "lib/ediel/prodat/prodatApplicationObjectValidation.ts": "72dd6d730ff55a55cde0969f4bb7465619b5a2a91439104f5365fbf939d36b3d",
  "scripts/ediel-z02-core-embedded-check.mjs": "65674a7d68ea01add3d5a08385b675f0b9d2f4368ea287f4864ca57a0970ebf6",
  "scripts/ediel-p-10-z02-correlation-sql-regression.mjs": "37d804c77d2cd9cf08a4e92e7391e9d2957704362c4994f6278c188e61b61897",
  "supabase/schema.sql": "df4a353f3f2bb1bfd4eb0f4be99c76ee89a65ffb98bdc345f78c6924e5e65df6"
}
```
