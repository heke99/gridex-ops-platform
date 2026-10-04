# Original UN/EDIFACT directory sources

These four ZIPs are unchanged original UN/EDIFACT directory archives mirrored in
`smooks/unedifact` at commit `5d11e96017dfb63f6b049066817039665c530b5d`.
The archive and exact nested document hashes are in `provenance.json`. Direct
UNECE retrieval returned HTTP 403; an independently authenticated official ZIP
hash/signature has not been obtained. The mirror origin remains explicit.

The original directory headers select PRODAT D97A, UTILTS D02B, APERAK D96A and
APERAK D04A. D96A APERAK itself identifies its publication as a draft
recommendation; the Swedish selected edition remains D96A. No adjacent edition
is substituted and no Smooks generated mapping is used as normative authority.

Original copyright and licence notices remain inside the unchanged archives,
including the UN distribution agreement in the D97A archive. Archives are data:
the historical executables inside them are never executed. The compiler reads
only directory text and generates structural facts, without changing or
redistributing modified source documents.

Run `python scripts/compile-ediel-unsm-grammar.py --check` to verify all ZIP and
member hashes and reproduce the generated message, segment and composite facts.
The compiler fails on an unrecognized directory row rather than guessing a
mandatory requirement or repetition count.

The full selected business-directory tree includes every optional and mandatory
group, each occurrence's own mandatory children, segment order and repetition
limits. It includes all elements and components in every used business segment,
including trailing elements omitted by shorter national tables.
Syntax version 3 data-element repeats are adjacent element positions, as
specified by original Part4 chapter2.2 clause8.2. Each used repeated composite
retains its own mandatory components and its exact selected-edition maximum.
The clause's source member hash is independently pinned in `syntaxSources`.
UNH/UNT service elements keep the separate envelope authority. CONTRL 2:2's full older service
message table has not been located in these sources and is not covered by this
package. Syntax version 4 data-element repetition is held because the existing
national tokenizer handles version 3. Generic unregistered families retain
their existing consumers and receive no new grammar approval claim.

An unsupported physical national directory is a source hold before CONTRL,
application processing and send admission. It is not an invented syntax-error
code or a claim that the counterparty sent an invalid message. Local consumer
tests and reproducible source facts do not constitute native execution,
interactive browser evidence, exact-head CI or whole-masterplan approval.
