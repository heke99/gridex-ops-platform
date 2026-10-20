# Independent final source review: current five-file routing delta

2026-10-14. **No confirmed P1/P2 introduced; approved for this bounded source review.** Canonical workspace `/tmp/gridex-ops-final`, base HEAD `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`, with the following reviewed uncommitted postimages. This report is the only file written by this reviewer; no SQL, engine, tests, GEN, native/backend, CI, capture or network call was performed.

| File | SHA256 |
| --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `9ba3dfba7995f70172683f759b0108a268cdd954075a634c274d8b71b5d2bc7b` |
| `scripts/gridex-derived-replay-inputs.py` | `8c8e47f5ac9c8054ce55a1246bdf6a279836b7b254a57ff9ea8ceadca4e0e02e` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `6dfdeeaa83809bc29d60a7460adb628631e91275928db9018d7309fde6e7e996` |
| `supabase/bootstrap/20261013_ops_permission_catalog_replay_adapter.sql` | `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` |
| `supabase/bootstrap/20261014_ops_atomic_bb0b_sc031_replay_adapter.sql` | `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` |

## Exact source identities and placement

Both new canonical bootstrap files are byte-identical to the two previously independently reviewed private proposals. Their SQL assessment is reused from `remaining-replay-proposals-final-two.md`; no whole SQL re-audit or new execution claim is made.

The descriptor has exactly two new entries, both `execution: sourcePosition`, both timestampedMigration, both explicit preserveSourceReplay=false. Removing these entries reproduces the previous entire JSON object; existing foundation/interleaved inputs, substitutions and descriptor metadata are unchanged. Artifact hashes match their actual bytes independently. Original source hashes independently match the unchanged immutable migrations: catalog104143 `2ce4e07ee2dee8ffb352e0e387092e7eb8a9bc6802723d408b40b9e0671e4519`; terminal effect113214 `a2a7e91e1bbb97e0b2d73171b1e0893fad9e4acf915ca620c02f25b8e6aa4a0d`.

Clean replay retains original canonical filenames as logical execution names and replaces only their actual execution paths. Boundary lookup and prior-version checks now use these logical names. Thus the catalog104143 remains the existing auth-expiry adapter's after boundary (`20261013104143..20261013110544`), despite its bootstrap filename being different. The terminal113214 effect remains at its original selected source position and requires no invented later migration/boundary. Interleaved artifacts retain their original insertion rule; foundation execution remains unchanged.

## Refusal and provenance structure

Both descriptor mergers reject conflicting execution identities. Unknown execution modes refuse. Source-position entries cannot also be foundation/interleaved entries, must have the exact timestamped source kind and explicit false preserve flag, and must execute a bootstrap artifact. Clean validates actual original/artifact bytes against pinned source/artifact identities, requires the original 14-digit timestamped filename, rejects duplicate or already skipped original positions, rejects noncanonical exclusion overlap, and requires every substitution original to remain present in the executable canonical history before replacing its path. Original collision guards are retained.

The shared committed-input helper similarly rejects unknown modes, dual declared source positions, wrong kind/preserve settings, unsafe paths, undeclared artifact placement, duplicate selected originals and checksum drift. It reads originals and artifacts from the requested commit rather than trusting workspace output. Existing upgrade/history callers select valid canonical pending filenames, reject immutable history changes, remove checksum-qualified noncanonical inputs, and materialize by original filename in their existing order. Substitutions outside that selected pending set are deliberately omitted; the helper does not claim that every descriptor executes in every pending window.

Materialization retains the canonical filename and canonical source SHA separately from executed artifact path/SHA, checks original bytes against the selected canonical bytes again, and preserves an original-source copy. Its explicit ledgerClaim is NONE. No fabricated applied migration, historical checksum change or adapter-name ledger identity was added.

## Incoming source preservation

Independently compared current actual files to their respective source commits. Incoming main `573d74371086da585a5cff6abee95eadfe58899e` bytes remain exact for `lib/ediel/inboundCases.ts`, `lib/ediel/rulebook/canonicalEdielFacade.ts`, and `20261014011520_ediel_sc031_source_owned_business_projection.sql`. All five previously reviewed API/Staff runtime postimages remain byte-identical to `b4146a58e0a571ea04dd7537a2e50cce68c9764d`: events route, apiResponseProfile, webhooks, identityResolution and onboarding. Prior finite integration review remains applicable to these unchanged files.

## Limits

This is source/postimage qualification of the five-file delta, not current committed capture, backend compilation, full clean/upgrade replay, native execution, restoration/rollback observation, GEN or CI proof. The coordinator's preflight counts, syntax results and ownership/custody readbacks were not reproduced by this reviewer. Those receipts must bind the final committed candidate and its complete selected input manifest. Prior pre-merge materialization and sealed old-body bb0 receipts do not prove current full-source qualification. Any change to these postimage hashes, routing declarations or original source identities invalidates this exact approval until reviewed.
