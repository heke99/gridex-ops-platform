# Independent qualification: authentic capture329 / artifact11325200901

Verdict: **APPROVE_AUTHENTIC_CAPTURE_ARTIFACT**. Import review remains pending the root's ready staging message. This review executes no capture, database SQL, test, browser, clean/upgrade replay or parity suite and makes no current runtime gate claim.

The producer is commit `329b079ff4aecde8164d5be057ffaf37e2334d9c`, tree `c1a15c0597cb32995b81a8a621d865afc3eeb96e`. Independently read GitHub APIs confirm successful capture-only run37260943445, attempt1, job111607846726, and artifact11325200901. The published artifact digest and local ZIP both equal `9353629de11059586e05caf1957d35e31d6e382a22f8b704d21feac380cfb657` (1,619,708 bytes). The raw receipt retains this producer, rather than attributing the capture to any later consumer/import commit.

All four unique ZIP members pass CRC validation and are byte-equal to `/tmp/root503-329-composed-capture`. Their SHA256 values are:

| Raw member | SHA256 |
| --- | --- |
| database.types.ts | 4f5713d630d848363dfa5d76c87adc9bb4c52a4dfb3fb3b4f53068f9606279c4 |
| schema.sql | 54a78fe9d04b87f961a11cf168af535670305c4a9335408110dab613a4caacb6 |
| schema.fingerprint.json | b04d843015d09146488a2c24a2bded67df9c3963ebe33caffd6ca303c42dbd44 |
| capture-receipt.json | cb3d361a01e7e311dcff36cd499fdcea1586ef7e22d85e10587278c1cb2bd13d |

Each of the receipt's eight replay-input SHA256 values independently equals the exact329 Git blob: replay script, base/additions/runtime migration manifests, producer types manifest, nullability override script, snapshot script and Supabase config. The receipt's latest migration `20261005020000_ediel_production_contract_ack_confirmation.sql` independently matches its exact329 Git blob, SHA256 `af03080ef1c5f57caaf9e4b221092f4271b1d90bc4e7f91143c68213a0d67aa1`.

Read the actual snapshot producer's `canonicalJson`/`buildFingerprint` implementation. Independently serialize the supplied13section metadata records with recursively sorted object keys and compact JSON; their SHA256 equals the fingerprint and receipt value `6ae86b71da37f26a0d61793ecd72277f4ecd8ed66ad642764d78ef23d601dc87`. Fingerprint and receipt carry identical54schema names. This recomputation verifies the supplied section-record aggregate, not a fresh introspection or a reconstruction of individual section rows.

Against329's retained generated outputs, database.types.ts is byte-identical; only schema.sql and schema.fingerprint.json differ. The changed schema/fingerprint bytes are genuine raw outputs, not manually composed generated artifacts. The old source manifest's main, root, TR04 and primary provenance pointer objects and current-prefix requirements are saved verbatim in the machine receipt as the post-import comparison baseline.

The raw receipt says `native_tests`, `browser_tests`, `type_schema_comparison` and `upgrade_parity` are all **NOT_RUN**. They remain so. Mandatory current clean/upgrade replay, native/browser, schema/type parity and release checks are separate work; this capture-only artifact does not satisfy those gates.

Methods: read-only GitHub run/jobs/artifacts APIs; Python hashlib/zipfile exact-member/CRC comparisons; read-only `git show329:path`/`git rev-parse329^{tree}`; JSON receipt/schema-list checks; canonical aggregate SHA256 recomputation. No source edits or execution of the replay/snapshot/workflow were performed.

Importer review will use the root's active checkout `/workspace/gridex-masterplan-retry`, not the old readonly329 checkout `/workspace/gridex-masterplan-main-union`. It must compare the finished import to the raw bytes, preserve the original raw receipt and ZIP, retain parent provenance pointers, qualify the producer's replay inputs on the consumer (allowing types-manifest metadata changes only), and keep the capture producer329 attribution. This review does not infer that staging is ready or that this source equality is already established.

Machine detail: `/workspace/agent-review-checkpoints/root503-329-capture11325200901-independent-receipt.json` SHA256 `52f051e6ce55d66391c44e340f8bf4184920e0d7679b0edcec813ed98e422e60`. Independent sanitized live API custody: `/workspace/agent-review-checkpoints/root503-329-capture11325200901-github-custody.json`.
