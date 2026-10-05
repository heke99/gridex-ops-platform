# SC-071: concurrent revocation and internal export

Status at published caller `f7fc20f7b5adc784bdd6ed01bd56ac56e53d2763`:
**qualified six-case native component; whole scenario UNAPPROVED pending
producer admission, main integration and final candidate gates.** Current
ten-case run37310521982 is parent-qualified10 PASS /0 FAIL /0 ERROR /0 SKIP;
independent artifact review also qualifies10PASS and all custody/source checks. Historical actual
44992cdd run37305623231 remains8 PASS /2 FAIL, with six SC071 cases PASS.

## Frozen criterion and actual boundary

The unchanged acceptance register SHA256 is
`e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`.
SC-071 specifies:

- Given: “Ett åtkomstgrant återkallas samtidigt som ett E66-resultat ska delas internt.”
- When: “Kör exportjobb och rättighetsändring parallellt.”
- Expected: “Kontroll av aktuell version och transaktionsgräns hindrar utlämning utan giltig rätt.”
- Prohibited: “Ett tidigare behörighetsbeslut får inte användas efter relevant återkallelse.”

The exercised distribution boundary is the sole producer's private internal
result commit and its real authority-checked read RPC. The actual worker uses
a durable queued job, captured grant version/scope and real lease token. Grant
administration and export execute in separate real PostgreSQL transactions;
the existing graph fence and observed ungranted locks establish ordering.

| Real concurrent case | Observed effect at449 | Frozen requirement witnessed |
| --- | --- | --- |
| Grant writer COMMIT before export | Export waits, then blocks; no result/completion. Revoked current and stale versions both refuse enqueue/read. | Current version and transaction boundary prevent disclosure after relevant revoke. |
| Grant writer ROLLBACK before export | Export waits, then completes one authorized page with retained DGI provenance; permitted read succeeds, wrong beneficiary refuses and replay adds no output. | Legitimate authority remains usable without fabricating a successful denial-only test. |
| Export transaction commits before waiting revoke | Other transaction sees no unfinished result/completion; revoke waits until export COMMIT. Afterwards retained-page reads and new enqueue refuse. | Earlier authorization cannot be reused after the later relevant revoke. |
| Original three projection/revoke races | Writer COMMIT, writer ROLLBACK and reader-first/revoke-wait all PASS. | Corroborates the same current-grant graph fence on the projection path. |

Assertions retain original E66/series/value/receipt snapshots and provider
effect counts, actual grant versions and captured immutable job scope. They
allow the legitimate revoke/history effects and inspect those separately.
Effect counts are not byte identity of every unrelated history/outbox row.
Actual page equality proves preservation of the authorized projection, without
claiming an independent oracle for every reading.

## Source and evidence custody

Registered SC071 source stays`6407877b…`; owned patch`a45ee4b4…` supplies
effective six-case source`33b7d52a…` only in the disposable BASE checkout.
Exact full hashes are in export-feedback-inputs.json. The current owner handoff
5994292830 selects all six producer inputs and unchanged SQL from9b50b1b9;
product baseline824 is recorded separately. Native14611ac1 changes only the
owner's two lease-test setups; source/config/SQL product bytes remain unchanged.

First actual artifact11343427856, ZIP SHA256
`ab140ff44e32fcde4dd6210f6a1b00992269026f021cfeb4c1f9ee083c51b3ab`,
was independently qualified against7,559 BASE Git blobs, immutable caller and
effective input hashes, actual job receipt, four RPC witnesses, zero skips and
unchanged48 official ledger versions. Raw failure/JUnit/receipt remain in
export-native-first-*. Both SC010 expiry cases received57014 before their
atomicity assertions; those effects were unqualified in that historical run.
The corrected actual run below qualifies both expiry cases.

## Remaining acceptance gates

The corrected ten-case experiment yielded exactly6+4 genuine passing cases
with zero failures/errors/skips and matching source/custody evidence;
independent actual-artifact review qualifies all ten actual cases. The retained coordinator must then admit the sole
migration, generate/verify schema/types through the existing canonical flow,
integrate the producer and effective native tests, and qualify current
candidate clean/upgrade replay and required CI. Shared files and coverage have
not been changed by this owner. See integration-handoff.json for the bounded
handoff inventory; no shared ownership transfer follows from this document.

Finite issuer/legal, SMTP and route-session selection ports are explicit.
These results do not grant whole TEN-10/TEN-12, authentic market qualification,
retention/purge qualification or a separate later SMTP/send boundary. The
experimental forward schema remains UNQUALIFIED_FOR_FINAL_CAPTURE.

Corrected actual artifact11345294346 has16members and ZIP SHA256
`90787405c69fa0ab78e6682834968ca9b7dbe2943a16ccb101c768f86023d991`.
Both source-owner lease cases now reach/pass their final atomicity assertions.
The exact job-log receipt equals the artifact receipt;7559 BASE blobs and
unchanged48 ledger versions were checked again. Raw passing log/JUnit/receipt
are in export-native-passed-*; the first failure is preserved separately.
