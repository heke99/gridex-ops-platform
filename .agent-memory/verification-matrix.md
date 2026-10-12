# Verification matrix — omfattning och gräns

Observation `2026-10-12T19:41:44.806238+00:00`. Aktuell ledger: 314/352; SHA256 `23956fce6dc25f225c069cee624d992e64b279d24b4457247bf5202cb75b6298`.

| Kontroll | Verifierat | Gräns |
| --- | --- | --- |
| #782 slutkälla och faktisk c1a-merge | 23 SUCCESS/10 villkorliga SKIP; exakt träd/föräldrar | Ingen ny helhetscoverage |
| #783 slutkälla och faktisk efba-merge | 16 SUCCESS/10 SKIP; exakt träd/föräldrar | SC054 PARTIAL; extern mergeroll inte retroattesterad |
| #775 slutkälla och faktisk 69e-merge | 32 SUCCESS/10 SKIP; exakt gemensamt träd 4f7c | SC053 PARTIAL; käll-CI är inte körning vid komponerad main |
| #786/#789 affected source | Två oberoende icke-medförfattande källpeers | Aktuellt CI/normalleverans och fysisk ERR förblir separata |
| #784/#785/#787/#788 | Exakta källfynd återkopplade | Ny rättad head behöver affected kvalificering |
| Root leveransguard | 12 äldre recovery-, 35 source- och 20 nya simulerade felkontraster | Offline/mocks; inget native/GEN/CI-bevis |
| Proxyreservationer | Receiptmatchade CREATE_IF_ABSENT/GET_MATCH för deklarerat scope | Ingen retroaktiv attest av arbete före reservation |

Aktuell main-push/full runtime, deploy, kompetent legal/provider/motparts-/LIVE-helacceptans påstås inte. Ursprungliga native-loggar/artefakter och faktiskt utfall kvalificeras av respektive befintlig kedjas utpekade insamlare. Samordningens granskning använder kod, offentliga kvalificerade kvitton och CI-metadata.

[Full tidigare verifieringshistorik](https://github.com/heke99/gridex-ops-platform/blob/69e50f4f0f8267dcdf4fe8414dac75ac1ab3e07a/.agent-memory/verification-matrix.md) bevaras i Git; gamla totalsiffror/promptar är inga aktuella godkännanden.
