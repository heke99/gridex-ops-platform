# Delegated sender — read-only acquisition receipt, 2026-09-23

Status: supplied export content and official schema/documentation recovered; no runtime sender authority qualified. E035 and frozen masterplan status unchanged. This receipt follows the design's “Next read-only acquisition path”; no implementation, hosted mutation, import/preview, provider message, SOAP request, account creation or browser fallback occurred.

## 1. Supplied source recovery

The Library folder `/Start av elbolag` contains the exact named original attachments:

| Artifact | Library identity | Original metadata |
|---|---|---|
| `companies.xml` | `libfile_64634bf34c0c81918c8b1da31adf8732`; `file_0000000046608243a1b686388bcdf800` | 787190 bytes; 2026-09-10T06:37:55.339917Z; model_generated=false |
| `companies.txt` | `libfile_a9e274c653608191b8bc1a6696b76b54`; `file_000000009b9082439080da21301ded72` | 97717 bytes; 2026-09-10T06:37:51.711047Z; model_generated=false |
| `Gridex_Ediel_Mastermasterplan_v2_komplett_paket_2026-09-10(3).zip` | `libfile_73366ffd12e88191a96c6fefa37296cf`; `file_00000000695881f5882c23259484e4e3` | 634967 bytes; September 19 upload; model_generated=false |
| Same bundle without `(3)` | `libfile_2500e84a90a48191a3f85b183ab0b6b5`; `file_00000000f0888243b06ad05e7e664d57` | 634967 bytes; 2026-09-10T10:17:47.790194Z; model_generated=true |

The supported download helper failed twice with HTTP 502, then stopped. This is a channel limitation, not absent source evidence. Library read returned the complete rendered XML and 700 rendered TXT lines. Derived local files are deliberately named `companies.rendered.xml` and `.txt`; their hashes are **not original-byte hashes**. XML rendering plus saved final newline is 787191 bytes; TXT rendering normalizes line endings and is 97019 bytes. Do not register these as byte-identical originals in an immutable source manifest.

`registry_selector_results.json` was not recovered. Exact local filename search (including ignored paths) found no original; three 200-item Library folder pages contained no matching standalone filename. The listing was not exhaustive. Find in the located masterplan Markdown returned no occurrence. Bundle members were not extracted because materialization failed. These are bounded search results, not proof that the annex is absent from the supplied archive or Library.

### Actual content, rather than invented relationship

Rendered XML parses into 697 companies across EL/SE and GAS/SE. Its header states `GeneratedAt=2026-09-10T06:35:24Z`, `SenderApplication=www.ediel.se`. These are claims within an uploaded file, not an authenticated acquisition receipt. There are 19 nonempty differing party/interchange PRODAT or UTILTS rows. A concrete relevant locator is EL/SE → company Ediel `64920`, Holmen Energi Elnät AB, role `Netowner` → PRODAT: `InterchangePartyId=81300`, `PartyId=64920`. Another is Svenska kraftnät `10000` PRODAT → interchange `49000`, party `10000`.

These are genuine supplied export records demonstrating distinct routing and legal-party identifiers at the asserted snapshot. They must not be replaced with synthetic aliases. Neither a differing ID pair nor a role/name is independently a sending mandate, a dated historical interval, an actor qualification or a tenant/grid-owner binding. No `ValidFrom` or `EDIFACTDelete` exists in the recovered XML; its only date-like attribute is the generation time. TXT has distinct PRODAT/UTILTS interchange and party columns but no historical interval fields.

## 2. Official reference acquisition and bounded semantics

Actual source chain: frozen T §7.4's `www.ediel.se` → official `/Portal` index → `/Info/webservice`, `/Info/userguideportal`, and XML export. The XML export link redirected to login; no sign-in was attempted. The webservice page was successfully read and its linked public schema/WSDL downloaded; a later repeat web open errored and does not invalidate retained bytes. No endpoint was guessed.

Official-document summary (under 200 words): The linked webservice page, updated 2024-12-18, documents SOAP 1.2, WS-Security UsernameToken and the Webbtjänstanvändare role. It identifies `https://ws.ediel.se/ExternalServices/ExportEdielParties/2016`; the newer service supports `IncludeUpcomingChanges`. The schema allows optional `EDIFACTDetails/@ValidFrom` and requires `EDIFACTDelete/@ValidFrom`, both dates. The currently linked guide is version 3.1.0 dated 2014-11-20, not a new rule publication. Pages 7–8 distinguish ASP, which supplies UNB addressing, from ESP transport/system service while principal responsibility remains. Pages 15–16 and 23–24 describe effective-dated, approved technical addressing changes. Page 24 distinguishes UNB and NAD details and actor-test needs. This establishes a real candidate producer and dated-change vocabulary, not a complete retrospective delegation contract.

Schema locators: `ExportPartyAddressing.xsd:102–153` (`EDIFACTAddressing`, repeatable details and deletion records, identifier qualifiers, Type, ValidFrom). The WSDL's `ExportPartyAddressingRequest/IncludeUpcomingChanges` is a required boolean; its addressing base types preserve optional detail dates and required deletion dates. The supplied export contains neither. Optional date omission does not mean authority since time immemorial. Future changes do not establish retained past history, withdrawal scope, date/time-zone boundaries, dispatch versus receipt semantics, or sending-direction entitlement. An old guide's “not implemented” changelog statement is not evidence about current history availability.

Official links:

- https://www.ediel.se/Info/webservice
- https://www.ediel.se/Info/userguideportal
- https://www.ediel.se/dokument/2.%20Edielregistret/Anv%C3%A4ndarhandledning/141120_handledning_Ediel-register_ver3-1-0.pdf
- https://ws.ediel.se/ExternalServices/ExportEdielParties/2016

## 3. Bounded hosted lineage, read-only

Project `piidsfebjqjmnepdpnas`. First inspected `information_schema.columns` for only `actor_registry_import_runs`, `actor_registry_import_items`, `platform_actor_import_runs`, `platform_market_actors`. Then selected design-whitelisted metadata for exact filenames or September 10 date; run lookups limited to 20, relevant item IDs to 10. No raw payload, contacts, broad customer data, secret fields or settings were dumped.

- Actor registry run `619bfe46-dcb3-4d4f-b83e-1bafe899384d`: `xml_upload`, `companies.xml`, completed 2026-06-15 11:08:46.972939–11:12:47.34 UTC, company null. Hash field is `286ad339209ef78eec176e2b1fc640299ea8669afc432adc60806e88dccaefed:1781521726903`; timestamp-suffixed value is not a raw digest. Exact run metadata has only parser, value `parseActorRegistryXml`.
- Platform run `ff9ca804-4df4-4035-99b6-878a167ee0c9`: `companies_xml`, `companies.xml`, completed_with_warnings, 2026-06-11 13:23:38.799525–13:28:17.882 UTC. Selected metadata: source `actor_registry_ui`, importedFromUi=true, fileName `companies.xml`, mode null. Metadata key names include `parsed`; its contents were not dumped.
- Exact June run items for 64920 and 81300 map to platform actors `7695fdfc-5df0-4082-b066-d2affc2cdfc5` and `3f81e0f0-ad94-47cd-abe1-2e088d3c466c`. Both selected actor rows say source `actor_registry_ui`, source_reference the June 15 run, imported_at respectively 09:56:19.032 and 09:56:26.042 UTC on June 15. Two items share 81300; no deduplication/identity authority was inferred.

No authentic original-byte artifact or provider integration/document reference emerged from this lineage. The June runs cannot be attributed to the September export. `integration_provider_accounts` was not queried because the design requires an actual provider reference first. User-upload lineage and current registry verification flags do not establish official capture origin or historical delegation.

## 4. Retained local evidence and hashes

All following files are in `/workspace/scratch/db7cad0629c3/sources/delegated-sender-candidates/`:

| File | Bytes | SHA256 and qualification |
|---|---:|---|
| `companies.rendered.xml` | 787191 | `ff3bbd4de3ea045baeb41b0cbafbe9d3b36499b147f323f35fa72b15e7e334ff` — rendered derivative only |
| `companies.rendered.txt` | 97019 | `aae96155c9770dadae6b725ee0f266e992aafcf486cb8bebf53d233fdc8bc2f9` — rendered derivative only |
| `ExportPartyAddressing.xsd` | 15500 | `b88d768a4858fee5572fe2b7a7de5f6b5afa78924749007f1923a5d1534a2941` — public official linked response bytes |
| `ExportEdielParties.wsdl` | 13718 | `f35b539a4de093b305abe50d0952932fcc8995f75bf405c7cc24de2072caa42b` — public official linked response bytes |
| `portal-guide-20141120.pdf` | 1028055 | `1dc4a6dfcc8e681bb9c7fa035970e211364b9358a1f751cbcc23e907885cd8ea` — public official linked response bytes |
| `export-content-observations.json` | derived | `53340247d498180249aaad4a183de8eb4e64dc247c47826abb43fbf38e8c6ca9` — parsed shape and differing-ID locators, not authority |

The guide's `portal-guide-20141120.txt` is a pdftotext derivative. `library-acquisition-input.json` in scratch records the supported helper selection; it is not a successful download receipt. Frozen manifests were not modified.

## 5. Concrete next boundary

Recovered: real supplied September addressing snapshot, relevant distinct-ID grid-owner examples, actual official service and dated-change schema, and concrete older user-upload lineage. Therefore “no real delegation candidate/source route found” is superseded.

Still unavailable here: byte-identical original materialization; selector annex/archive contents; authenticated official export/capture for the target scope; documentation or qualified evidence that the selected record authorizes sending PRODAT for that principal with the necessary eligibility and exact interval; past changes/withdrawals covering a historical source receipt. These are distinct gaps. Do not state that the provider cannot supply history; its history surface was not accessed. A current authentic response could establish an observed current relationship only within qualified semantics; it cannot retroactively authorize September or earlier originals.

Engineering may prepare the typed XML/WSDL-preserving parser and immutable capture interface against these actual field names, with explicit unknown dates and deletion records. Retain the owner design's SQL-independent selection, scope, temporal and retrospective-correction barriers. The lossy existing upload projections cannot become a trusted capture producer by changing a flag. Before positive owner implementation acceptance, establish a permitted authenticated acquisition adapter and narrow source contract, then obtain a record covering the required source receipt. Missing historical evidence continues to hold only relevant delegated sources. No mock, public schema, manual reviewer statement or upload hash closes this gate.

Skill routing: Library for supplied originals and supported materialization; Supabase for bounded read-only lineage. No deployment, import, mutation, UI automation or test execution was needed. Git was clean at inspection; concurrent closure work was neither edited nor evaluated by this receipt.
