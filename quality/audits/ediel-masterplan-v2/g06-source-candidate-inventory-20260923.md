# G06 public grammar source candidates — 2026-09-23

Bounded acquisition, not full-directory/grammar certification. No runtime, frozen manifest or repository edits. Originals are in `sources/g06-candidates`; JSON inventory records exact URL, byte length and SHA256. Only needed syntax/service packages were downloaded; application-directory originals remain unacquired in this environment.

## Correct target tuples, confirmed from national originals and production

| Purpose | Base tuple | National overlay / actual caller |
|---|---|---|
| PRODAT | PRODAT:D:97A:UN | P §1.6/p41; E2SE6A electricity, E2SE6B gas. `prodat/registry.ts:28`, compatAdapter and customerMasterdata/facilityLookup renderers use canonical directory/association. |
| PRODAT APERAK | APERAK:D:96A:UN | P §1.6/p97 and UNH example; association follows applicable P market profile. `ack.ts:995` electricity E2SE6A. |
| UTILTS / UTILTS ERR | UTILTS:D:02B:UN | U §1.6/p71 E5SE5A; `utilts.ts:545`, `ack.ts:996`. |
| UTILTS APERAK | APERAK:D:04A:UN | U §1.6/p112 E5SE5A; `ack.ts:994`. |
| CONTRL | CONTRL:2:2:UN:EDIEL2 | T §2.1.1 and example; `ack.ts:991`. This is a national service-message overlay, not D96A application grammar. |

Therefore the initial PRODAT96A/UTILTS04A search leads were wrong target combinations. Do not substitute96B/04A for97A/02B. Testing-helper mismatches were observed but not traced for reachability or classified as production defects; they are not normative source oracles.

P p40 and U p70 explicitly distinguish abbreviated national segment descriptions from the full UN message. National omitted tails (P CCI4051; U MKS1229 and other IDE/NAD/LOC data) cannot define complete syntax. National required R versus base mandatory M also affects APERAK versus CONTRL. Preserve national constraints and base grammar as separate layers.

T §2.1.1 explicitly retains CONTRL2:2 and action codes1/4 while identifying international1997 D:3 and4/7/8 differences. Do not replace the Swedish reply profile with the downloaded international service-message default. T §4.2 pairs UNOB with syntax2, UNOC with syntax3. Current JWG home defaults to syntax4-release3; use its explicit syntax1–3 document/archive links instead.

## Application-directory candidates and retrieval receipts

| Candidate | Official URL / evidence status |
|---|---|
| PRODAT97A message + table | https://service.unece.org/trade/untdid/d97a/trmd/prodat_c.htm ; `prodat_d.htm`, `prodat_s.htm` same directory. Official search indexes identify97A; direct/web opens403. |
| APERAK96A definition + directory | https://service.unece.org/trade/untdid/d96a/trmd/aperak_d.htm ; https://service.unece.org/trade/untdid/d96a/trmd/trmdi1.htm . Official indexed identity96A; opens403. Segment-table URL `aperak_s.htm` attempted but content not retrieved. |
| UTILTS02B complete message | https://service.unece.org/trade/untdid/d02b/trmd/utilts_c.htm . Web retrieval identifies02B/revision3/date2003-02-13 and structure; raw download403. No original-byte hash claimed. |
| APERAK04A complete message | https://service.unece.org/trade/untdid/d04a/trmd/aperak_c.htm . Official search identifies04A; raw/open retrieval failed. |
| Segment/component continuation | UTILTS02B message links followed to `d02b/trsd/trsddtm.htm` and `trsdunh.htm`:403. For97A `trsd/trsdlin.htm`, `trcd/trcdc212.htm`,96A/04A `trsd/trsderc.htm` also403; these candidate paths are not acquired grammar. Use exact revision's TRSD/TRCD/TRED/UNCL indexes and reachable links before recursively acquiring only the selected message dependencies. |

Followed official archive/index routes: https://unece.org/1995-1999 and /2000-2010 (the national references), https://unece.org/trade/uncefact/unedifact/download, https://unece.org/fileadmin/DAM/trade/untdid/texts/unredi.htm, and96A content/index pages. They returned403 here; the official indexed download page lists97A/96A and indexed UNTDID archive page advertises historical HTML packages. No accessible original ZIP link was recovered from those blocked pages. A guessed historical ZIP path was not accessible and is not promoted to an established source URL. No foreign-version mirror was substituted.

This is a concrete acquisition-channel failure, **not a finding that official source does not exist or an external user-upload blocker**. Next step is a later successful fetch of these official index/package links; do not reconstruct HTML bytes or hashes from search snippets. Search snippets and parsed web content are useful identity leads, not authenticated package bytes.

## Acquired syntax/service originals

The frozen T reference7 points to https://service.gefeg.com/jswg/ which redirects to `/jwg1/`. Its home links `Current/d31.htm` (Syntax1–3) and `Archive/v3/data/v3.html`; those link the PDFs/ZIPs below. PDF magic bytes and ZIP member listings were checked. The archive labels its syntax3 page outdated; this correctly distinguishes the historical syntax target from today's default4. The service-message text has revision1/date97-03-17 but blank cover version/release fields, so use the national explicit overlay and document clauses rather than invent those metadata.

| Original file | Bytes | SHA256 | URL |
|---|---:|---|---|
| jwg1-d31.htm | 17168 | `67b6fd14fac72bb974c9ed2d344a6286c64b64d74a87b7dbe77a7308c54d59ec` | https://service.gefeg.com/jwg1/Current/d31.htm |
| jwg1-id1.htm | 17148 | `769d07bf1c22985d7ab32dfaedbc7bf165e85b495161213adda9491c8d918e65` | https://service.gefeg.com/jwg1/Current/id1.htm |
| jwg1-v3-sced.zip | 2298 | `3aea8609ceffb62f7cd3a0d38df6fe758c7e464e12459a6daf74d5d670300947` | https://service.gefeg.com/jwg1/Archive/v3/data/v3-sced.zip |
| jwg1-v3-sded.zip | 4779 | `4981bc1db933448fd55b0c68c5fc4be2c0f8606b2ecab2193b2e25c4ff3414e0` | https://service.gefeg.com/jwg1/Archive/v3/data/v3-sded.zip |
| jwg1-v3-smed.zip | 8012 | `70c4b49248fd48eb39e471369edcd4c27ad4c3eee26fdd228d0d8d1f7b6721bc` | https://service.gefeg.com/jwg1/Archive/v3/data/v3-smed.zip |
| jwg1-v3-ssed.zip | 2997 | `87b0afd3c2ed6331a4490a94430e0b5485192cb52dddbec12e3c66fdeee91d72` | https://service.gefeg.com/jwg1/Archive/v3/data/v3-ssed.zip |
| jwg1-v3.html | 25736 | `b661c984c023d6c18beec12caf745ef4ba42416f36eadd7dd6289b190de4babf` | https://service.gefeg.com/jwg1/Archive/v3/data/v3.html |
| v2-9735.pdf | 54270 | `e9dc9dbf0075a54259a53ac9213efce7b69a71a8389d39da3c51e476fdef4ae2` | https://service.gefeg.com/jwg1/Files/v2-9735.pdf |
| v3-1992_amd1.pdf | 3903868 | `b8be652f154cbfe89a00486181ba86eadbdb9492f675f37f2549103e3844febb` | https://service.gefeg.com/jwg1/Files/v3-1992_amd1.pdf |
| v3-Contrl.pdf | 48748 | `5fa00d8d8aca557b85885d9c2868e567cebfc5a99c355e174839db607d4258ba` | https://service.gefeg.com/jwg1/Files/v3-Contrl.pdf |
| v3-Guide.pdf | 76834 | `9c2733c7560dac2160327858fd25302b9f4c42b774506f784b606cdad2166b6f` | https://service.gefeg.com/jwg1/Files/v3-Guide.pdf |

Packages contain service-message CONTRL, service segments, service composites and service elements respectively. The syntax3 amendment supplements the syntax2 base; the implementation guide is explanatory and the CONTRL PDF/service directory must be read with national T overrides. These are source candidates, not evidence of parser conformance or every selected code-list revision. No application D97A/D96A/D02B/D04A business segment/component package was successfully downloaded yet.

Remaining finite G06 work: acquire exact application dependencies; qualify source/version/precedence; map grammar constructs to production tokenizer/parser/preflight/ACK callers and independent tests; validate every supported physical message. None is satisfied merely by these hashes. No implementation or broad helper audit was started.
