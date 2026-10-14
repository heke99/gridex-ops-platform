# Independent Auth expiry replay adapter final source review

2026-10-14, read-only review of actual uncommitted source in `/tmp/gridex-ops-final`. Observed HEAD `fa66f9533361f29f05d23ce643c93116859d12c9`, tree `d8c41033943dbfe8ee2831b14478ffff963b25ba`.

## Conclusion and version binding

No bounded source-blocking finding. Reviewed adapter SHA256 `070b2e524b964c78e9e99a91553f8d4eab74811fb8a76e994cfe8e52088b84fa`, actual additions-plan SHA256 `1e8a946ce627f8e5705c0c33cbafc715ce5de15128805ab444908296ee0bdc49`. Immutable original `20261013105521_ops_api_current_auth_token_expiry.sql` remains unchanged at SHA256 `9e3dc9544031b8d42acdaa850c9ba1963d8b6b6ff0c7d35c76f1be49368ba7bf`. This is source-only review, no native/GEN/complete replay/CI/delivery PASS.

## Exact five-target comparison

Parsed original and adapter configuration as data and compared every field. Five native `original` literals, native `before` hashes, patched bodies, target `after` hashes, signatures and expected attributes are unchanged. Only the two Staff targets gain `canonicalBefore` and `canonicalOriginal`.

| Target | Native before MD5 | Added canonical MD5 | Unchanged output MD5 |
| --- | --- | --- | --- |
| Staff invitation | `6999018e1805f9e4f46cad882e9a92bb` | `f17387d5c7c6994773b54739b5b2de86` | `55ec7a03bf1dcc1f6f469d78527b0c8e` |
| Customer identity decision | `9a23932976decde1027eb0876ce2731c` | none | `63f7ccdf09f86e5fe8f917a6560fb00e` |
| Canonical tenant acceptance | `5e7710d3653185c9c6307cc06d197a0a` | none | `84da220e65ca1a019bdf55b33fa1664c` |
| Private integration authentication | `2b0a050792d5b2b8cdb3eae99a2fe45e` | none | `67d81f7ae7ccd87a030dc3c25a311b69` |
| External Staff acceptance | `0942960e95856e8071b0bb0ef799df61` | `8bce4c7e18ff33066b80eb5073307a01` | `2a7f912ecc0d982365a5abd423afab0b` |

All five patched literals independently hash to exact target MD5s. Added canonical literals exactly equal the original function bodies from:

- `20261005101527_staff_independent_onboarding_authority.sql`: file SHA256 `ac58bb9af7f94b31b2daaa526e4bb2fc19793179b29e2118e1ca2c2813f32492`; canonical body SHA256 `7742e72ad17c18a65efeedc270607f744e7b7055100cc219ab79e0cdaed5d17d` and MD5 f17387d5… .
- `20261005124901_tenant_staff_external_identity_bindings.sql`: file SHA256 `c6bf00b74eddc2b99b1e3b95baff3705a1c4291c41469c840297d67cfaa0f7f3`; canonical body SHA256 `a44d3a3df205f51a05a1d30c56df6b534eae44617e32469e2058e1aee948b2c6` and MD5 8bce4c7e… .

Source/native body diff contains only two pairs of Staff explanatory comments and one pair of external Staff comments. Executable SQL is unchanged by those predecessor variants. Migration-name/source search found no intervening replacement of these two target bodies before105521.

## Guard logic and effects

Adapter retains original existing-core requirement, exact expected attribute comparison and after-body no-op recognition. The predecessor guard rejects unless either `(native MD5 AND exact native literal)` or `(canonical MD5 AND exact canonical literal)` matches. This follows directly from the two OR mismatch groups joined by AND. A hash-only match, literal-only match or crossed pair cannot qualify. For the three targets without canonical fields, JSON extraction returns NULL; non-NULL body/hash `IS DISTINCT FROM NULL` is true, so the canonical mismatch group is true and supplies no bypass. Unknown bodies fail closed.

After validating one complete pair, replacement uses exactly the fetched `before_function.prosrc`, rather than the native original literal which would not occur for the comment variant. The existing exact-definition containment check remains. All expected roles/ACLs, owner, function identity/arguments/defaults, output modes/types, language, search paths, volatility, security mode and other represented attributes are identical. Original post-replacement full pg_proc comparison excluding only prosrc is unchanged, with exact after MD5. Atomic transaction, dependency/function guards, bounded timeouts and notification remain unchanged. The five actual expiry/post-lock behaviors are inherited byte-for-byte from original patched bodies; no new body effects, role grants, customer writes or source-history claims were added.

Minimal nonconfig diff: six explanatory header lines; paired-predecessor mismatch check; containment/replacement changed from native original to already validated actual body. No other SQL changes.

## Three replay builder applicability

Plan diff only adds descriptor and interleaved row. Source105521 is the only manifest migration strictly inside `(20261013104143,20261013110544)`; both endpoints exist. Descriptor preserves source kind, source9e3d SHA, independently executed adapter070b SHA and preserveSourceReplay=false.

Clean replay validates source/artifact pins, suppresses original105521 execution and inserts adapter between catalog104143 and analytics110544. Both strict upgrade and history union use the shared candidate-committed descriptor resolver, which validates normalized paths, identity conflicts, selected source membership, original/artifact hashes and sole-source open interval. They preserve historical originals separately, materialize executed adapter bytes, and record source/executed hashes with NONE ledger claim. Their unchanged callers execute materialized paths. Existing ancestry/manifest/earlier-source/order/noncanonical protections remain intact.

Routing source postimages remain identical to prior reviewed versions: clean SHA `7c2ab100784fe3aab8ee8a350254e272adbfb96aad04f2a61d199a5d7cc0c8cb`, helper `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c`, strict planner `2286b227e967c9686c7e0541397c2fcb5814de5e1a02c5d5286bd17314e3c5de`, union planner `4005c1ad9d0b52596e4f5bc52e009c68cbfc3d923f9ffe5e7d844c58f45d5750`.

## Limits

No planner execution, native DB, GEN, tests, CI rerun, network, ref changes, publication or shared/source writes. Only this private report was written. Review binds actual postimage hashes; later execution must bind the eventual candidate commit containing them. Custody/claim verification remains with parent; source correctness review does not attest foreign ref ownership or grant whole-history qualification.
