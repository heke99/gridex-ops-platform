# F3-H / GOV-02 / P-05 — source map for PRODAT registers

Status: original source read; runtime implementation and qualification not yet complete.

## Evidence

Original P26.A revision 3, updated 2026-06-30, 140 pages, fetched from
`https://www.ediel.se/Portal/Document/3338`. Its SHA-256 is exactly
`83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`,
matching the unchanged original `source_manifest.json`. Public-GET-only evidence
run `35254532103`, artifact `10512087971`; no production credentials were used.
Pages 15, 16, 47 and 114–116 were extracted from that PDF. Page images 114–116
were independently visually inspected, including the six-row table on p116.
No OCR, inferred PDF identity, other revision, or generated rule projection was
used as a substitute for the original. The original package remains unchanged.

## Precedence and identity

P §2.2 p15 expressly limits its table to register 1; annex 2 governs register 2+.
§2.2 takes precedence over conflicting annex-4 conditions.

Field 314 is `SG8/LIN/1082`, n..6, increasing by one from 1 over every LIN in
one message (p47). Field 258 is `SG8/LIN/C829/1082`, n..6, with indicator
`C829/5495=1`. It starts from 1 for each object, is present for every register
of a multi-register meter, and is omitted for a single-register meter (pp16,47,115–116).
Only Z04/Z06/Z10 report multiple registers. Separate physical meters must use
separate unique (possibly fictitious) object IDs, not meter-number subgroups
under the same object (p114). No omitted/deduplicated register is allowed, even
when its measurements equal another register (p115). Wire evidence cannot
prove an unreported trailing register exists: supplied authoritative expected
counts must be checked separately; internal sequence continuity alone is not
a completeness certificate against an external meter inventory.

## Register 2+ field table (p116)

| Field | Z04 | Z06 | Z10 | Register-local rule |
| --- | --- | --- | --- | --- |
| 209 | R | R | R | Same object identity as register 1; never borrow an absent identity. |
| 258 | R | R | R | Different per register; 1..m per object, not global LIN sequence. |
| 213 | R | D | D | May differ. Z06/Z10: required when supplied for this object's register 1. |
| 214 | D | D | D | May differ. Z04/Z06F/Z10: required when meter readings are sent. Z06E/G: required when supplied for this object's register 1. |
| 218 | D | D | D | Same condition as 214; own register's number of integer digits. |
| 259 | D | D | D | Own time-frame code; same presence condition as 214. Source §2.2 pp19–20 also excludes it in electricity when no meter readings are sent. |

314 remains mandatory on every LIN independently of the six business rows.
First-register 213/214/218/259 retain §2.2 pp18–20 requirements. In particular
214/218/259 are optional for first-register Z06E/G, not unconditionally required
whenever some other register has a value. The first-register reading predicate
and register-2+ overlay must compose in the existing condition engine.

## Reuse versus preservation

P p115 requires the receiver to use all other non-mandatory SG8 information
from register 1 and ignore repetitions on registers 2+. Examples explicitly
include the other CCI/CAV, RFF and NAD fields. Those repetitions remain in raw
wire/provenance but must not override inherited object values, acquire a new
customer identity, alter a date or reassign a meter/network. Core fields
213/214/218/259 are never filled from another register. Header fields are not
part of the register overlay and cannot be supplied inside a later LIN.

The implementation groups within one message by decoded object identity and
identity agency. It must not conflate escaped delimiters, case-distinct IDs,
objects in different messages, or a second meter with a second register.
Interleaved objects are tested without inventing a source prohibition on
interleaving: the per-object counters and first-register authority are what matter.
An invalid/ambiguous topology must retain wire evidence but cannot authorize
inheritance, staging or sending. Missing/duplicate/skipped/reversed indices
remain blocking, not repaired by sorting or deduplication.

## Complete field-scope inventory

The JSON companion retains all 74 original first-register usage columns and
locators. The following table is a source map, not a second runtime rule authority.
Parent groups UD/IT/IV follow their first-register parents; individual members
are listed below. First-register subtype and parent overlays are not waived.

| Field | Name | First Z04/Z06/Z10 | Register 2+ authority |
| --- | --- | --- | --- |
| 311 | Application Reference | R/R/R | message_header_once |
| 312 | Version | R/R/R | message_header_once |
| 202 | Meddelandenamn | R/R/R | message_header_once |
| 203 | Meddelandeidentifikation | R/R/R | message_header_once |
| 204 | Meddelandefunktion | O/O/O | message_header_once |
| 313 | Kvittensbegäran | R/R/R | message_header_once |
| 205 | Meddelandedatum | R/R/R | message_header_once |
| 206 | Tidszon | R/R/R | message_header_once |
| 301 | Fritext (huvud) | O/O/O | message_header_once |
| 207 | Avsändare (Ediel-ID) | R/R/R | message_header_once |
| 315 | Avsändarens org.nr | -/-/- | message_header_once |
| 208 | Mottagare (Ediel-ID) | R/R/R | message_header_once |
| 314 | Sekvensnummer | R/R/R | message_global_sequence |
| 209 | Anläggnings-id | R/R/R | per_register |
| 258 | Sekvensnummer | D/D/D | per_register |
| 210 | Avtal, startdatum | R/D/D | first_register_authority_ignore_later_repetition |
| 211 | Avtal, slutdatum | -/O/- | first_register_authority_ignore_later_repetition |
| 302 | Rapportstartdatum | O/-/- | first_register_authority_ignore_later_repetition |
| 321 | Rapportslutdatum | -/-/- | first_register_authority_ignore_later_repetition |
| 216 | Giltighetsdatum – giltig from | -/R/R | first_register_authority_ignore_later_repetition |
| 212 | Datum för första mätaravläsning | O/-/- | first_register_authority_ignore_later_repetition |
| 249 | Födelsedatum | O/O/- | first_register_authority_ignore_later_repetition |
| 508 | Tidslängd (tidsperiod) | R/D/R | first_register_authority_ignore_later_repetition |
| 326 | Tillståndets tidstämpel | -/-/- | first_register_authority_ignore_later_repetition |
| 327 | Tjänsten/rapporteringen upphör | -/-/- | first_register_authority_ignore_later_repetition |
| 303 | Fritext (per anläggning) | O/O/O | first_register_authority_ignore_later_repetition |
| 213 | Uppskattad årsenergi | R/O/O | per_register |
| 214 | Konstant för mätare | D/D/D | per_register |
| 215 | Konstant, gammal mätare | -/-/O | first_register_authority_ignore_later_repetition |
| 217 | Mätmetod | R/D/R | first_register_authority_ignore_later_repetition |
| 218 | Antal siffror, mätare | D/D/D | per_register |
| 219 | Antal siffror, gammal mätare | -/-/O | first_register_authority_ignore_later_repetition |
| 306 | Installationsstatus | R/D/- | first_register_authority_ignore_later_repetition |
| 307 | Tariffkod | O/O/- | first_register_authority_ignore_later_repetition |
| 220 | Prioritet | O/O/- | first_register_authority_ignore_later_repetition |
| 222 | Rapporteringsfrekvens | R/R/R | first_register_authority_ignore_later_repetition |
| 223 | Transaktionstyp (undertyp) | R/R/R | first_register_authority_ignore_later_repetition |
| 259 | Mätare, tidsintervall (räkneverkskod) | D/D/D | per_register |
| 254 | Avräkningsmetod (dygns/månads) | R/D/D | first_register_authority_ignore_later_repetition |
| 242 | Produktkod | R/D/D | first_register_authority_ignore_later_repetition |
| 506 | Produkt id (Energiprodukt) | -/-/- | first_register_authority_ignore_later_repetition |
| 310 | Kundstatus | -/D/- | first_register_authority_ignore_later_repetition |
| 513 | Riktning (Typ av anläggning) | -/-/- | first_register_authority_ignore_later_repetition |
| 322 | Tillståndets status | -/-/- | first_register_authority_ignore_later_repetition |
| 323 | Tillståndets syfte | -/-/- | first_register_authority_ignore_later_repetition |
| 324 | Orsak till tillståndets upphörande | -/-/- | first_register_authority_ignore_later_repetition |
| 224 | Mätarnummer | R/O/R | first_register_authority_ignore_later_repetition |
| 225 | Gammalt mätarnummer | -/-/R | first_register_authority_ignore_later_repetition |
| 308 | Leverantörens avtalsnr | -/O/- | first_register_authority_ignore_later_repetition |
| 260 | Nätområdesid | R/R/R | first_register_authority_ignore_later_repetition |
| 320 | Värmevärdesområde | D/D/- | first_register_authority_ignore_later_repetition |
| 240 | Serie-id | D/D/D | first_register_authority_ignore_later_repetition |
| 319 | Referens till anläggning | D/-/- | first_register_authority_ignore_later_repetition |
| 261 | Referens till avtal/fullmakt | -/-/- | first_register_authority_ignore_later_repetition |
| 226 | Ärendereferens | R/R/R | first_register_authority_ignore_later_repetition |
| 325 | Tillståndets id | -/-/- | first_register_authority_ignore_later_repetition |
| 227 | Kund-id | R/D/- | first_register_authority_ignore_later_repetition |
| 228 | Namn-elanvändare | R/D/- | first_register_authority_ignore_later_repetition |
| 229 | Adress-elanvändare | D/D/- | first_register_authority_ignore_later_repetition |
| 231 | Postnr-elanvändare | R/D/- | first_register_authority_ignore_later_repetition |
| 232 | Postort-elanvändare | R/D/- | first_register_authority_ignore_later_repetition |
| 316 | Land-elanvändare | R/D/- | first_register_authority_ignore_later_repetition |
| 233 | Anläggnings-id | R/R/- | first_register_authority_ignore_later_repetition |
| 234 | Adress-anläggning | R/R/- | first_register_authority_ignore_later_repetition |
| 235 | Postnr-anläggning | O/O/- | first_register_authority_ignore_later_repetition |
| 236 | Postort-anläggning | O/O/- | first_register_authority_ignore_later_repetition |
| 237 | Land-anläggning | O/O/- | first_register_authority_ignore_later_repetition |
| 250 | Fakturamottagare ID | D/D/- | first_register_authority_ignore_later_repetition |
| 251 | Namn-fakturamottagare | D/D/- | first_register_authority_ignore_later_repetition |
| 252 | Adress-fakturamottagare | D/D/- | first_register_authority_ignore_later_repetition |
| 253 | Postnr-fakturamottgare | D/D/- | first_register_authority_ignore_later_repetition |
| 317 | Postort-fakturamottagare | D/D/- | first_register_authority_ignore_later_repetition |
| 318 | Land-fakturamottagare | D/D/- | first_register_authority_ignore_later_repetition |
| 262 | Balansansvarig | R/R/R | first_register_authority_ignore_later_repetition |

## Qualification boundary

No passing tests, exact-head CI or review/merge is claimed by this source map.
The separate register branch starts at `28b2a9ad1d745acaa4ea7fe15af7608da95e7884`
on merged PR327/main `51c73950515d771d2c2edcb97fde28ab087437a3`.
PR310 remains paused and unchanged. No SQL/generated DB types/grants, live
DB writes, storage writes, deployment command or external Ediel messages.
The remaining 110 original D-cell review is a separate task after register merge.
