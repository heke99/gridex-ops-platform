# Scoped source amendment: UTILTS sender and temporal identities

Status: source comparison for fields 203, 207 and 505 only. This does not amend the frozen 121 rule cards, 231 acceptance contracts or source manifest, and does not certify G01 or a historical duplicate implementation. The current guide's 25-A-4 filename / 25-A-5 page footer discrepancy remains open.

| Primary original | Identity and effective window |
| --- | --- |
| Prior English `251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3.pdf` | SHA256 `fad5cf4f775f86258ab9d5827426d54e57881b6298836110359cf0e41706a798`; effective 2025-06-01. Its 2025-10-01 translation/publication date is not its effective date. |
| Frozen current Swedish `260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf` | SHA256 `0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be`; effective 2026-10-01. |

| Identity | Prior original | Current original | Narrow conclusion |
| --- | --- | --- | --- |
| UTILTS BGM/C106/1004, field 203 | BGM note p73 and appendix 1 p127: nonblank document ID, unique over time across the sender's UTILTS applications; error 42 if duplicate. | BGM note p72 and appendix 1 p122 retain the temporal requirement and error 42. | This is a whole-UTILTS-message identity, separate from UNB/0020 and UNH/0062. Do not apply this U rule to PRODAT BGM/203 or to outgoing APERAK A203. |
| SG2/NAD+MS/C082/3039, field 207 | Sender field p52 and NAD notes pp77–78: the sender is the legal Ediel actor; a representative of the interchange belongs in UNB, not NAD. | Sender field p51 and NAD notes pp74–75 retain the legal actor distinction. | The physical NAD sender identifies the normative issuer namespace. Its claimed value is not proof that the inbound tenant, legal actor and representative were authenticated and durably bound. |
| SG5/IDE+24/C206/7402, field 505 | IDE note p79 and appendix 1 p128: sender's transaction number, unique over time independently of its applications, returned in APERAK or UTILTS-ERR; error 42 for duplicate. Revision history p9 says the temporal requirement and negative APERAK for duplicates were already in effect from April 2010. | IDE note p77 and appendix 1 p123 retain those requirements. The resend discussion p45 requires a new number when transactions are sent again. | This is a physical transaction identity, independently reserved from BGM/203. A new interchange carrying an earlier 505 is not an identical retry of the earlier original. |

The prior English original is a published primary source for this bounded comparison; the corresponding prior Swedish edition has not been supplied. No conflict was found in these selected clauses. This finding closes the *selected clause comparison*, not the historical-source, domestic edition, legal ownership or receiver-disposition gates for G01.

## Implementation boundary and required owner proof

`gridex_received_sources.sources` captures incoming PRODAT prospectively, not the entire historical UTILTS corpus. `gridex_utilts_binding.receipts` freezes a UTILTS source context only after first consumption; its receipt key and advisory locks are source UUID plus transaction. Physical membership checks reject repeated IDE numbers within one source before receipt/series writes, but they cannot decide two different originals from the same legal sender across applications or after deletion. The 2026-06-04 migration deliberately removed an overbroad transaction index that collided with legitimate interchanges.

A sender-wide reservation requires a trusted NAD+MS and tenant/legal-actor mapping **before** disposition or ACK, authentic pre-ledger and deleted-original coverage, a lawful retention decision, separate immutable 203 and 505 identity records, atomic concurrency and an explicit identical-original retry model. Then test competing originals with distinct UNB, allowed distinct legal issuers, malformed/unauthenticated sender, same-original byte-stable retry, per-IDE mixed outcome and negative ERC42/203 or 505 with no forbidden writes. No such owner is implemented or market-enabled by this amendment. The native two-physical-IDE negative control in `scripts/ediel-utilts-consumption-native.test.ts` checks only the already existing per-source fail-closed boundary.
