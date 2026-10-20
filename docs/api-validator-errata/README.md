# Older API validator errata

These source artifacts correct three known errors in strict validators generated from immutable OPS OpenAPI documents. They do not change the archived source, its checksum, incoming business requests, tenant authorization or legal/pricing evidence. The platform still supports the registered V1 profiles described in the [compatibility policy](../api-compatibility-policy.md).

| Surface | Original revision | Correction | RFC6902 source patch |
| --- | --- | --- | --- |
| customer-portal-v1 | `2026-10-02.3` | support-detail-messages | [support-detail-messages](2026-10-02.3-customer-portal-v1-support-detail-messages.rfc6902.json) |
| website-integration-v1 | `2026-10-02.3` | fixed-quote-null-market-reference | [fixed-quote-null-market-reference](2026-10-02.3-website-integration-v1-fixed-quote-null-market-reference.rfc6902.json) |
| website-integration-v1 | `2026-10-04.1` | fixed-quote-null-market-reference | [fixed-quote-null-market-reference](2026-10-04.1-website-integration-v1-fixed-quote-null-market-reference.rfc6902.json) |

The Customer support-detail patch replaces only the impossible `allOf` composition with the same closed base fields plus its required `messages`. Without this correction, no object can satisfy the original schema: messages are simultaneously forbidden and required. The Website patches allow a null `market_reference` only in quote-validation data; fixed-price quotes have no fabricated market evidence.

Keep the original document and obtain the patch and [checksum manifest](manifest.json) from the same reviewed GitHub commit as this guide. These are GitHub source downloads, not API endpoints. Open the [OPS repository](https://github.com/heke99/gridex-ops-platform) at the reviewed delivery commit, select `docs/api-validator-errata/`, and use GitHub's raw-file download for the selected patch. The commit-specific source URL has the form `https://github.com/heke99/gridex-ops-platform/blob/<reviewed-commit>/docs/api-validator-errata/<patch>.rfc6902.json`. The relative links above stay bound to the version of this guide being viewed.

1. Verify the original source SHA-256 and patch SHA-256 against the manifest. Preserve the immutable original as evidence.
2. Apply RFC6902 to a separate document. Each patch first tests `info.version` and the exact erroneous schema node. Stop if a test fails; do not apply it to another surface or revision.
3. Generate the client validator from the corrected derivative. Keep its source revision, patch checksum and derived document checksum together. The manifest's derived checksum uses sorted-key compact UTF8 JSON followed by one newline.
4. If the validator enforces an older response version constant, have an authorized OPS operator pin the credential to that supported profile. A caller-supplied version header does not select a representation.

Whitespace or serialization normalization can change a file checksum. An unrecognized document must be reviewed against the known source before applying an erratum; failing a checksum or RFC6902 test never authorizes a generic schema relaxation. Previously compiled contradictory validators cannot be repaired by changing only a server response header.

No blanket assertion that every archived strict validator accepts every current response follows from these patches. No tenant/provider end-to-end qualification is claimed by a source correction.
