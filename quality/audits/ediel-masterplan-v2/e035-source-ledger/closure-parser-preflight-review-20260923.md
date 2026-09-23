# Closure parser checkpoint preflight — 2026-09-23

**Verdict: no blocking source-binding defect found in static review of this private parser checkpoint. Native execution remains unverified. This is not approval of the closure owner or of completed closure behavior.**

Reviewed only the exact `closure-parser-preflight.diff` snapshot against baseline `0e81b119`, approved design section 3A, and baseline tokenizer/UNA/register-group behavior. Later working-tree implementation was not treated as the reviewed snapshot. No broad tests or SQL execution were performed; the reported 34 passing TS tests after eight red assertions are author-supplied evidence, not independently rerun here. Only this requested review report was written.

## Source-binding findings

No concrete blocking source-substitution error was identified in the named risk surface:

- SQL reads advice before normalization, distinguishes active separators, rejects unsupported repetition advice, and consumes release sequences in one lexical state machine. Decoded components are never split again. Literal terminators/data/component separators/release characters therefore cannot manufacture physical segments or authoritative fields.
- Original bytes, physical segments, decoded component lengths and physical LIN count have explicit limits. Dangling release and unterminated input yield no projection. The matcher coalesces an absent projection to false.
- The projection checks the physical UNB/UNH/UNT/UNZ structure, trailer references/counts and header BGM identity. It derives FR/DO and the transport tuple from original composites, applies direct-sender/no-subaddress restrictions, and derives the header timezone.
- It enumerates every physical LIN before selecting by complete reconstructed object equality. Message reference/index, object/agency, line index/number, physical segment index and singleton register geometry cannot be changed solely in caller scope. Duplicate physical identities and C829 forms are held.
- DTM93, paired Z13/CAV reason and LI are read within the selected physical object's own bounded regions. The twelve original digits are independently converted through fixed standard time. Exact derived JSON equality binds minute **and** UTC, LI, document, function, subtype/reason, parties and object geometry; additional marker-wire keys fail equality.

## Narrow parity observations (non-blocking holds)

The SQL and TS support sets are not perfectly identical. SQL requires the lexical LIN number to equal the ordinal string (`"1"`); baseline register grouping checks its numeric value, so a scalar `"01"` can pass that particular TS grouping check but is held by SQL. SQL's trailing-space check handles ASCII space/tab, whereas TS `trimEnd()` rejects additional Unicode whitespace. These do not provide an identified way to substitute a different original authority value: the ordinal case holds in SQL, and decoded values remain exact in the other case. Pin these boundaries in focused parity fixtures or document them before claiming complete SQL/TS input-language equivalence. No such equivalence claim is justified by this preflight.

## Evidence still required

The native tests in this snapshot are private lexical/projection/matcher probes. Their use of synthetic closure fixtures does not establish canonical acceptance of every custom-advice/escaped fixture, an accepted assessment, or a witness. The separate canonical Z05 fixture assertion covers its ordinary fixture only. Execute the native lexical suite against the installed private functions before claiming PostgreSQL validation; static review cannot establish compilation/runtime success or observed grant behavior.

The next owner slice must obtain `sources.raw_payload` itself under the validated source/company/environment/hash binding in the append-time owner validation statement. The private matcher currently accepts a raw-string argument by design; until that sealed-column call and the owner branch exist, it is not an enforced append boundary.

Retain the explicit next-slice owner probes from design 3A: otherwise-valid real owner rows and accepted originals; same-date minute plus matching forged UTC; LI/document/reason/function/object/agency/legal and transport tuple/physical geometry mutations; cross-LIN borrowing and apparent released segments; no assessment or witness creation on failure; positive custom UNA/escaped-reference/CRLF/multi-object originals; and observed red then green append assertions with binding absent then installed. These are outstanding owner integration requirements, not failures of a completed owner claimed by this checkpoint.
