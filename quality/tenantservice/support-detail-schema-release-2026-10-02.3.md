# Closed support detail and release metadata correction

Prepared on 2026-10-02 from `d8a5a111c02c1805b0be4a03284ecd178b40c947` on isolated branch `fix/support-detail-schema-2026-10-02`. This evidence concerns source and local checks. It does not establish deployment or tenant activation.

## Reproduced defects

- The mounted support-case detail response includes `messages`. Its documented `allOf` extends a `CustomerSupportCase` object with `additionalProperties:false`, so a conforming validator rejects every detail response containing `messages`.
- The actual release manifest fails nine closed-schema checks: five missing top-level fields, two missing `immutable_url` fields, and two incompatible classification values.
- Immutable OpenAPI routes previously used the global current contract version in response headers, making historical document headers advance with later releases.

The new regression first failed on the mounted response (`data contains undocumented field messages`) and actual manifest. The correction keeps the base case, detail, message, manifest, specification and deprecation-item objects closed. The detail schema combines the documented base properties and required fields with required `messages`, without an incompatible `allOf` branch.

## Release and compatibility

`2026-10-02.3` is a schema correction relative to `2026-10-02.2`. Request requirements and business response fields stay unchanged. Current version metadata and envelopes advance to `.3`; strict clients must allow that version. The minimum tenant integration version remains `.2` and release classifications are `backward-compatible`.

Both current specifications and new immutable snapshots/routes are generated together. The original support generator and finalizer reuse the corrected schema builders, so regeneration cannot recreate the closed-base conflict. The `.3` preparation script and materializer were rerun successfully without changing output. Historical document responses derive their version header from the document; the manifest retains the current runtime-version header.

Previous immutable `.2` JSON, routes and fixture were not edited. Archive SHA-256:

| Specification | `.2` archive SHA-256 | `.3` archive SHA-256 |
| --- | --- | --- |
| Customer Portal | `161559a56cc5e3bed2ebc94b9a11301ca3a6437cb180957ac4510a40ce4fc001` | `f62a661391842ce7d834dd17dc5ee57a17d235507c50c8f86a814130f0e187e3` |
| Website Integration | `96bd47c98b828849d8ca7456de654866a3adcea213a6ee92850e99c4d315bd36` | `f9f8ad121ee71b9b562cc250b9d86bd7d237e67cc57cdfaae60d3a7fe30cd0be` |

Runtime manifest digests use the exact normalized response bytes; the existing release metadata parity tests verify that distinction.

## Validation

All successful checks used supported Node `22.23.3`:

- 12 affected Vitest files, 64 tests passed, including real mounted support detail, nonempty/empty conversations, unknown and missing fields, malformed messages, real manifest validation, nested closure and historical 200/304 header parity.
- Quality functional suite: 31 tests passed.
- Application and test TypeScript checks passed.
- Scoped TypeScript ESLint passed; new/modified generator syntax checks passed. Repository ESLint excludes `.cjs`, so no CJS lint coverage is claimed.
- `npm run api:docs` passed all seven constituent checks.
- Compatibility gate, local immutable release verification and multitenant website application regression passed.
- `git diff --check` passed. No archived `.2` file changed.

No production database change, secret, domain, tenant configuration, runtime enforcement flag or API scope changed. Local validation does not substitute for native CI or post-deployment manifest/checksum verification.
