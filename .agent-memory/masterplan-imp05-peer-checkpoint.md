# IMP-05 retained-owner probe handoff — 2026-10-04

- Read-only owner request [#4915985008109](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985008109). Separate `codex/ediel-imp05-peer-probe-evidence-20261004` branch from actual main `56192d16d1eac7fb0e716a3e2770bac8e58be115`. PR526 at4f063408 and PR515 at8abd0cf9 stay frozen. No production, test-suite, workflow or coverage change.
- Existing outside-git probe is published **byte for byte**, once, as [original-outside-git-probe.zip](../quality/audits/ediel-masterplan-v2/integration-20261001/imp05-peer-probe/original-outside-git-probe.zip). This quarantined snapshot is not a new executable repository test/helper/policy. It contains the exact original config, observing test, reused synthetic fixture and original21:40:29 receipt. No generated key material, real customer data, live issuer or secret is included.

| Exact archived file | SHA256 |
| --- | --- |
| `probe.config.mts` | `fcd2dcf01fcd7fb03e1e9e3f24c3d606876910302d3cea53aa856954b0966a42` |
| `smtp-readiness.test.ts` | `9510474f7a5469f691ab92e6750756a3a9bfa0a9bb6685670cea73e3636da127` |
| `syntheticEdielRecipientFixture.ts` | `ca7544709c2407b97e3a0b15e6d50cdfd03232acf14849190aa2bd1980bbb089` |
| `receipt.log` | `d1675b2c924f46c938358c78d3152c608c90a6a22c96cfc56ccd91819d677330` |
| Whole immutable ZIP | `e3260f928aeb49196a2e82e7b4dfeb44af3b9aa60d6e34c9ac2784c441af63e8` |

The test is the existing `__tests__/ediel-recipient-readiness.test.ts` (base643 blob `14f854931d4b71f4a008da4ca31816788eb1d628`) with its fixture import relocated and the two observing cases appended. The reused helper is `__tests__/helpers/syntheticEdielRecipientFixture.ts` (base643 blob `eeb217651514718cb1d4976734addc57127fe5b1`), with only `subjectAltName=email:old-recipient@example.invalid` added to its existing signed recipient extension. The other18 existing cases are filtered/skipped, not new passing evidence. No alternative builder or SAN/alias matching rule is introduced.

The source was base643ea134 at original execution. Current readiness/resolver/trust/setup blobs are unchanged at56192d16 and frozen4f063408: readiness `7464ef9873b204fe429d0979b7d7a6839d9f7d8e`, resolver `8eef646e17c1bb709766a4dca48a02995c6cfeff`, trust `3e27c1254b9fd2384c11c9dc1bbb6ab9507d3cb8`, setup `ac7701a3c198c9ef73805c09227978ae8a816f49`. Wider main composition is not qualified by this observing probe.

Exact synthetic inputs are preserved in `authority()` and `arrange()` inside the archive. They are not actual private registration rows: RPC `gridex_ediel_certificate_trust_read_v1` is substituted and returns this object only for matching company/environment/EdielID. Company `10000000-0000-4000-8000-000000000001`, environment `production`, receiverEdielID `91100`, registrationId `synthetic-readiness-registration`, registerVersion `synthetic-unit-v1`, originalReference `synthetic://readiness-unit-only`, originalSha25664 lowercase `a`, authorizationReference `synthetic://does-not-authorize-live-traffic`; validity now-60000ms to now+86400000ms. Recipient fingerprint is dynamically computed from the same generated leaf, anchors=[generatedCA], intermediates=[], CRLs=[generated cleanCRL]. No SMTP/address/route-version witness is in this substituted authority.

The certificate row is `id=recipient`, company above, tenant_owned, production, active, outbound_recipient/encryption, ownerEdielID91100, ownerSubaddressPRODAT, familyPRODAT, businessCodeZ04, PEM/fingerprint/validity from the existing generated fixture. The profile is `profile`, communication route `communication-route`, active/enabled, smtp/smime, existing ready/live/approved cache, no unencrypted production, receiver subaddressPRODAT, family/codePRODAT/Z04, explicit recipientID. The exact complete profile/metadata is in `arrange()`. Both cases set profile `smtp_to`/`receiver_email` and communication `target_email` to old-recipient@example.invalid (control) or new-recipient@example.invalid (contrast). Same leaf/authority stays bound to old email; only the addressed target changes. Actual `evaluateRouteProfileProductionReadiness` invokes the actual resolver/set/PKIX/CRL code with applyFixes=false, approveProduction=false. `X509Certificate.checkEmail(old)` succeeds and checkEmail(new) is undefined. DB tables/RPC are finite synthetic ports; no hosted query/write/send or native/issuer authorization is proved.

The SAME unchanged probe was rerun22:18:49 with Node22 and this exact command (dependency-ready source checkout; no new probe implementation):

```sh
PATH=/tmp/gridex-env01-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH NODE_OPTIONS=--require=/workspace/gridex-masterplan-imp03-05/scripts/lib/unit-loopback-network-boundary.cjs /workspace/gridex-masterplan-imp03-05/node_modules/.bin/vitest run --config /tmp/gridex-imp05-smtp-probe/probe.config.mts --testNamePattern 'IMP05 SMTP identity boundary inventory' --reporter verbose
```

Result: exit1, **1 PASS /1 RED /18 skipped**; both actual readiness results are true, so the changed-address hold expectation fails. [same-probe-replay.log](../quality/audits/ediel-masterplan-v2/integration-20261001/imp05-peer-probe/same-probe-replay.log) SHA256 `dba9fce5a942014dd9ec35f19ae01eb2681ecdf2d95c0860ccc4ab39620117dc`. Original archived receipt is preserved separately with its exact historical timestamp/hash. This is a narrow acceptance observation, not a proven imported-route/live-send bypass: actual materializer/current-source/scoped-proof gates still hold changed imported routes. Retained owner must independently inspect any separately verified certificate/address binding; SAN-only matching is not assumed. IMP05/AT stays unapproved; return-path evidence remains absent.

For the separate executor, extract this SAME archive outside the checkout. Verify per-file hashes first; then change only the two executor-specific paths in the existing config (scratch root and source checkout), retain exact test/fixture bytes, and link the dependency-ready source node_modules. Node22/OpenSSL and the existing CI loopback-boundary preload are the prerequisites. For example from the source checkout:

```sh
GRIDEX_IMP05_SOURCE_CHECKOUT="$(pwd)"
GRIDEX_IMP05_SCRATCH="$(mktemp -d /tmp/gridex-imp05-owner-review-XXXXXX)"
unzip quality/audits/ediel-masterplan-v2/integration-20261001/imp05-peer-probe/original-outside-git-probe.zip -d "$GRIDEX_IMP05_SCRATCH"
sha256sum "$GRIDEX_IMP05_SCRATCH"/probe.config.mts "$GRIDEX_IMP05_SCRATCH"/smtp-readiness.test.ts "$GRIDEX_IMP05_SCRATCH"/syntheticEdielRecipientFixture.ts "$GRIDEX_IMP05_SCRATCH"/receipt.log
export GRIDEX_IMP05_SOURCE_CHECKOUT GRIDEX_IMP05_SCRATCH
python3 - <<'PYCONFIG'
import os
from pathlib import Path
p=Path(os.environ['GRIDEX_IMP05_SCRATCH'])/'probe.config.mts'
p.write_text(p.read_text().replace('/tmp/gridex-imp05-smtp-probe',os.environ['GRIDEX_IMP05_SCRATCH']).replace('/workspace/gridex-masterplan-imp03-05',os.environ['GRIDEX_IMP05_SOURCE_CHECKOUT']))
PYCONFIG
ln -s "$GRIDEX_IMP05_SOURCE_CHECKOUT/node_modules" "$GRIDEX_IMP05_SCRATCH/node_modules"
NODE_OPTIONS="--require=$GRIDEX_IMP05_SOURCE_CHECKOUT/scripts/lib/unit-loopback-network-boundary.cjs" "$GRIDEX_IMP05_SOURCE_CHECKOUT/node_modules/.bin/vitest" run --config "$GRIDEX_IMP05_SCRATCH/probe.config.mts" --testNamePattern 'IMP05 SMTP identity boundary inventory' --reporter verbose
```

Original T locator: **https://www.ediel.se/Portal/Document/3314**, fetched in the existing ENV01 source inspection, reused here without pretending a new source retrieval. Frozen manifest `docs/ediel/masterplan-v2/registers/source_manifest.json` IDT: filename `260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6(4).pdf`, version24.A revision6, updated2026-02-20,60pages; actual PDF SHA256 `5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951` matches. Local original `/tmp/gridex-env01-technical.pdf`; original extracted text `/tmp/gridex-env01-technical.txt` SHA256 `74206a973da4ed9918910def07376c96bbf281f46786a563fa15c2b746be55b3`. A.4.2 is both printed page52/60 and actual PDF page52 (text lines2838–2849); peer may retrieve the exact URL and verify frozen hash before interpreting complete AnnexA. A.4.1 on the same page assigns a responsible identity owner; it is not an SMTP SAN-only algorithm.

Exact A.4.2 address-change paragraph (line breaks joined, spelling preserved):

> Eftersom ett certifikat är knutet till aktörens SMTP-epostadress behöver man byta certifikat när SMTP-epostadressen för meddelanden som ska krypteras ändras. Antingen då till det certifikat som redan är knutet till den nya SMTP-epostadressen om sådant finns, eller genom att beställa ett nytt certifikat.

Next: retained TR06/readiness owner performs read-only source/refutation using this published immutable probe and full originalAnnexA/registered-address evidence. No product/alias/SAN/schema/trust policy candidate is authorized by this annex. Root keeps526/515 frozen and owns shared integration/CI.
