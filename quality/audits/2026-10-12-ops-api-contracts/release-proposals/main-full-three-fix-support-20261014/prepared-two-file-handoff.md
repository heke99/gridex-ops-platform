API source handoff for the existing mainfull correction helper, following the user's request to help the other agents fix the errors.

Reuse only these two immutable postimages from PR #794, head `6047439998a677a34f154b353c575687d01ca81a`, against main `573d74371086da585a5cff6abee95eadfe58899e`:

| File | Main blob | Donor blob |
| --- | --- | --- |
| scripts/gridex-website-quote-integrity-regression.mjs | 632728ef27fc4be9d66f17dacbe9c700599a3bf7 | 86bf85ef582cbbed4d74f2612951e7d563364a38 |
| scripts/gridex-price-area-assurance-regression.cjs | c2e0418246cceb6f6573ff621c8f929356db157d | b72b962e1685215f0780a65ba342d01df604a327 |

As the API donor writer, I hand these exact two images to the existing helper `codex-ediel-brp-history-helper-20261013` for selective adoption. My writing in these two files is paused during receipt. ROOT's receiving assignment, verified receiver custody/CLAIM and separate SOURCEGO still precede technical writes. This is no handoff of other PR #794 files, runtime behavior, frozen specifications, GEN, native execution or serial merge.

A new independent read-only review confirms the fixes against actual production exporter, response, fixture and enforcement sources: documentation `2026-10-12.1` and wire `2026-10-09.1` retain their distinct meanings. No gate is removed and no product or coverage PASS is inferred from a script result. The two donor fixes are already published in PR #794.

I am preparing the small source-guarded search_path proposal for the existing data-quality owner separately. Preserve the applied historical migration; the receiving owner creates any new migration with the official CLI. No competing shared source, GEN, native or CI producer is started.
