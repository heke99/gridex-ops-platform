# Godkännandekandidater — granskning 2026-10-04 (spec-to-code-compliance + fp-check)

Underlag: `npm run ediel:masterplan-v2:test-coverage` på #426 `f32e40b5` (helt grön CI) listade sex
märkta-gröna, ej godkända ID:n. Varje `condition`/`on_pass`/`on_failure` och AT-`expected`/`prohibited`
prövades mot kod och asserterande test. **Inget ID godkänns**: alla har minst en effekt utan asserterande test.
Leveranskontraktet (AGENTS.md) kräver test för varje effekt.

| ID | Bevisat (test) | Saknar asserterande test (att bygga) |
|---|---|---|
| TEN-01 | Tenant/juridisk aktör/roll/transport är skilda typer; kontext byggs fryst, ofullständig kontext avvisas (`__tests__/ediel-outbound-execution-context.test.ts`); ingen tenantlös aktör (`ediel-actor-role-profiles`) | (1) kernel: misslyckad grind ⇒ inget meddelande/ingen kundmutation (`createCanonicalOutboundMessage` i `lib/ediel/core/kernel.ts`); (2) prohibited: tenantens namn/domän/mejl kan aldrig bli marknadsidentitet |
| TEN-02 | Juridiskt id ≠ transport-id; separata DDQ/DGI-profiler; avsändare måste vara profilens | prohibited: inget automatiskt byte till Gridex-id och ingen automatisk registrering av tekniskt ombud |
| TEN-05 | Roll härleds från 23-DDQ/23-DGI-PRODAT; fel/okänd referens ⇒ ingen roll | prohibited: Z14 aktiverar inte leverans; Z04 ger inte generellt ESCO-tillstånd |
| TEN-06 | Juridisk mottagare endast familjens kvalifikator (PRODAT DO, UTILTS MR); aldrig avsändarens MS (`ediel-inbound-mail-legal-receiver`) | on_failure/prohibited: oklar attribution hålls i skyddad karantän; ingen tenant gissas från kund-id |
| U-04 | Sen äldre version (egen 532/512) lagras som historik, nyare förblir aktuell (`scripts/ediel-utilts-late-version-sql-regression.mjs`, PGlite) | on_pass: positiv APERAK när övriga kontroller passerar; prohibited: ingen ERR och ingen retroaktiv faktureringsändring för enbart sen ankomst |
| U-14 | Mottagen UTILTS_ERR-dispatcher framför lagringsauktoriteten; ACL (`ediel-utilts-err-ack-dispatcher-sql-regression.mjs`) | expected: atomär lagring av accepterad data + disposition + ACK-avsikt före extern positiv APERAK för vanlig UTILTS; prohibited: köad/mottagen räknas inte som lagrad (native/SQL-bevis på samma rad) |

fp-check: alla luckor bekräftade genom sökning efter asserterande test (`grep` av felkoder/funktioner i
`__tests__` och `scripts`); inga otaggade test täcker effekterna. Inga nya kodfel hittades i granskningen.

Nästa agent: bygg testen ovan två regler i taget (TEN-01+TEN-02, TEN-05+TEN-06, U-04+U-14), godkänn i
`coverage.json` i samma PR när alla effekter är gröna.
