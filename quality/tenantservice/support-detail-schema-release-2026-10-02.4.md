# Support schema correction after the published attachment release

The isolated branch `fix/support-schema-combined-2026-10-02.4` retains the published `.3` attachment-header release and prepares closed-schema corrections as `.4`. Its final base is main `d9dda64a19e5733e0324600ce072c36b38c716c7` (merged PR457), including earlier claim approval and invoice/webhook/website-write fixes. Original PR456's local branch remains unchanged; this evidence concerns the replacement `.4` patch.

## Release collision and live verification

PR456 and PR457 initially prepared different immutable `.3` artifacts. PR457 added binary support download headers; it did not correct the closed detail or manifest schemas. Its `.3` was subsequently published. It is therefore preserved exactly, and this correction advances to `.4`.

The live release manifest and immutable `.3` URLs were fetched directly on 2026-10-02. Manifest build commit was `d9dda64a19e5733e0324600ce072c36b38c716c7`, release/minimum integration version `.3`, classification `breaking-client-update-required`. Both immutable responses matched the exact PR457 archive after the pre-existing serializer's metadata normalization, including the manifest digests.

| Contract | `.3` preserved raw archive SHA-256 | `.3` live/normalized response SHA-256 |
| --- | --- | --- |
| Customer Portal | `0a73e04c0c775b5b41e8eb14e26f8893acb9474f178ed8cb46965d30af4d28d0` | `f6eb115d099f3b7105155fdc5e6923c8bf4072eb41d83d6f495e297e5b4f50cf` |
| Website Integration | `c6a13c2426f16bec0d630b3c912cec02b01336368196a7b9596b11b30332e948` | `500bfcb0b5558f49590b4316a22093036383f0204921e97b8e39a072eaed2c8e` |

The raw/served distinction comes from existing serialization, including a stale archive release extension; historical archives were not rewritten to normalized bytes. The `.2` raw Portal/Website archive hashes remain `161559a56cc5e3bed2ebc94b9a11301ca3a6437cb180957ac4510a40ce4fc001` and `96bd47c98b828849d8ca7456de654866a3adcea213a6ee92850e99c4d315bd36`.

## Correction and compatibility

The detail schema's `allOf` extended a closed `CustomerSupportCase`, rejecting its existing `messages` property. `.4` flattens only the documented case fields plus required `messages`; case, detail, message, envelope, manifest, specification and deprecation-item objects stay closed. The manifest now documents its actual metadata and classification values.

Current release metadata becomes `.4`; minimum supported integration remains the actual live `.3`. Classification is `backward-compatible` relative to `.3`. `.2` remains a historical immutable contract; this release does not advertise it as supported.

PR457's attachment runtime/spec headers are retained. Binary downloads use the current `.4` version and echo a nonempty request ID, generating a UUID for a missing or blank value. Historical OpenAPI 200/304 responses use their document version; the current `.4` specification documents those individual version constants. The manifest continues to use the current runtime version.

The new `.4` preparation script reuses closed-schema builders and requires the preceding attachment header correction. The original `.3` preparation script, `.2`/`.3` archives, routes and fixtures are unchanged. Regeneration of `.4` was repeated successfully with identical output.

New `.4` raw archive SHA-256:

- Customer Portal: `442ee521e2286a3364de082cce50b68be3085db7855caf151a8999005b790503`
- Website Integration: `10fb2f3051f112990fe4ef63ffa18b24ee5d9b5203b1f4429a2a3d88675c43be`

## Validation and boundaries

Supported Node `22.23.3`: 12 affected suites/66 tests and quality functional 31 tests passed. Coverage includes actual mounted detail validation, nonempty/empty messages, missing/unknown fields, nested closure, actual manifest validation, raw historical archive hashes, historical catalog/200/304 headers and actual binary GET headers/checksum/private cache behavior.

Application/test TypeScript, scoped TypeScript ESLint, changed generator syntax, all seven `api:docs` gates, compatibility, local immutable release verification, canonical runtime/OpenAPI parity, mechanical checks, multitenant website flow and `git diff --check` passed. CJS is excluded by repository ESLint; syntax and executable checks cover the generators. Native exact-head CI and post-deployment `.4` checks remain separate.

Only public API metadata/documentation, the closed schema correction and response header consistency change. No production database, credential, scope, customer identity enforcement, tenant/domain configuration or deployment was changed by this agent. Live verification establishes `.3`, not `.4` deployment.

## Current-main publication candidate

The correction was cherry-picked without conflicts onto actual main
`61fc46fe8dbf0df5fb940ef85ff8d14063159783` in isolated branch
`fix/support-closed-schema-release-2026-10-02.4`. Latest-main and direct
cache-busting live fetches agree on `.3`, minimum tenant integration `.3` and
that build commit. The actual `.3` detail still rejects `messages`, and its
website schema rejects the actual live manifest on nine property/enum errors.
Search-engine cached documents are stale and were excluded from release proof.

Fresh Node22.23.3 on the current-main candidate: 58 tests in nine affected
support/attachment/contract suites; application and test TypeScript; all
`api:docs`, compatibility, immutable release and canonical runtime/parity gates
pass. The preceding composed identity/merge/`.4` tree `fc93791a` separately
passes 66 tests across eight affected suites; this is composition evidence for
that tree only. Current-main `.2`/`.3` archives remain identical. Full exact-head
CI and live `.4` deployment remain required; this candidate needs a new draft PR
and must not rewrite conflicting PR456's already-published `.3` release.
