# Independent approval: authentic capture329 staged import

Verdict: **APPROVE_STAGED_AUTHENTIC_CAPTURE_IMPORT** for the exact working bytes read in `/workspace/gridex-masterplan-retry`, pre-import HEAD `bf936cf08adbdbd356bdfaad29c45c131573a1d6`, tree `5aedd096a1bf226f0ee4311598da89cb0db3542b`. This approves the capture bytes, narrow source-input carry and importer provenance; it does not claim a new capture, current runtime execution or an unpublished import commit.

The prior independent artifact qualification remains unchanged: authentic producer `329b079ff4aecde8164d5be057ffaf37e2334d9c`, tree `c1a15c0597cb32995b81a8a621d865afc3eeb96e`, successful run37260943445/job111607846726/artifact11325200901, published/local ZIP SHA256 `9353629de11059586e05caf1957d35e31d6e382a22f8b704d21feac380cfb657`. See the separate original review and machine receipt, which have not been rewritten.

All three imported generated files are byte-equal to the genuine raw capture:

| Generated file | SHA256 | Compared to pre-import |
| --- | --- | --- |
| supabase/database.types.ts | 4f5713d630d848363dfa5d76c87adc9bb4c52a4dfb3fb3b4f53068f9606279c4 | Unchanged |
| supabase/schema.sql | 54a78fe9d04b87f961a11cf168af535670305c4a9335408110dab613a4caacb6 | Genuine changed raw bytes |
| supabase/schema.fingerprint.json | b04d843015d09146488a2c24a2bded67df9c3963ebe33caffd6ca303c42dbd44 | Genuine changed raw bytes |

The archived ZIP and raw receipt are byte-identical to the previously qualified originals; the archived ZIP also passes CRC. The raw receipt SHA256 remains `cb3d361a01e7e311dcff36cd499fdcea1586ef7e22d85e10587278c1cb2bd13d`. `manifest.capture` equals the entire raw receipt as a JSON object, including its producer329, tree, latest020000 migration/hash, eight input hashes and all four **NOT_RUN** flags. Artifact metadata records the same genuine run/job/artifact IDs and public Actions ZIP digest. No consumer head is substituted for the producer.

Independently compare all eight receipt replay inputs against the exact pre-importbf936cf0 Git blobs: 8/8 equal producer329 hashes. In the imported working tree, the seven non-manifest replay inputs remain byte-equal; only `scripts/supabase-types-manifest.json` changes to describe capture/provenance metadata. The entire committed `supabase/migrations` Git subtree is the same object `7575d1b61a5fe9e724d4f1aa7c26b9e12e4e5fa3` at329 andbf936cf0, and no migration working change exists. This preserves all root forwards and sole-primary P08 migration source bytes without claiming that a later runtime replay was executed.

Working types-manifest SHA256 is `038426f133dcf31030f456a102b09c0fcf98316a8ded63161fe9610fff3c3151`. Captured latest migration is020000 and `composition_capture_pending=false` is accurate for this imported artifact. The same manifest explicitly keeps mandatory current execution gates pending. Original main, TR04, primary and nested root provenance-pointer objects are unchanged. Original current-prefix migration references and requirements are unchanged; its kind now explicitly says authentic capture imported/current mandatory gates pending and adds producer329/tree, pre-importbf936cf0 and the metadata-only input exception. The new immutable producer329 pre-import-manifest pointer and current sole-owner8904457f pointer independently match their stated Git blobs and SHA256 values. The producer's previous capture history remains reachable through the exact original329 manifest pointer.

Tracked dirty paths at review are only the two owner memory/checkpoint files, types manifest and the two changed genuine generated artifacts. Read the added checkpoint/handover text: it retains current-gate and partial-card limits. Coverage and production/migration sources have no importer working change. Extra untracked owner current-main review copies are outside this narrow import verdict.

Methods: readonly `git rev-parse`, `git show` and bounded path diffs; Python byte/SHA256 comparisons and JSON equality; archived ZIP CRC validation; read only changed metadata/checkpoint text. No capture, SQL, test, native, browser, replay or upgrade/parity execution. Root's reported minimum Node-baseline success is not a reviewer execution claim. The exact current published head still needs its required clean/upgrade/native/browser/schema/type/parity/release gates.

Machine receipt: `/workspace/agent-review-checkpoints/root503-329-capture11325200901-import-independent-receipt.json`, SHA256 `d3fba399265f2d600c8b5f60f2939ac3f8bc496687507db2c4133bb4f5e6f044`. Original artifact machine receipt remains SHA256 `52f051e6ce55d66391c44e340f8bf4184920e0d7679b0edcec813ed98e422e60` and original review SHA256 `b529c70309fb70de86803301fcfa412c152598acf71bb66e76bc56f6fe67ff30`.
