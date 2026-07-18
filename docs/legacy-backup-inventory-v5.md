# Legacy backup inventory – V5

Kontroll utförd 2026-07-18 före borttagning av sju
`.before-lint-type-hotfix`-filer.

- Samtliga backupfiler hade en aktiv motsvarande fil utan backupsuffix.
- Ingen produktionskod, konfiguration, dokumentation eller test refererade
  backupsuffixet.
- Samtliga backupfiler skilde sig från och var ersatta av sin aktiva version.
- De aktiva versionerna ingår i typecheck, lint, regressionstest och build.

| Borttagen backup | SHA-256 före borttagning |
|---|---|
| `eslint.config.mjs.before-lint-type-hotfix` | `870f1adccecf3051cbcd9fd307cef51d7633cf510979c181a81f4b1797273493` |
| `app/admin/customers/[id]/profile-actions.ts.before-lint-type-hotfix` | `67eb244b42cb1ec06696f3ec09d658be873c02226f0a67a29c44eb633190f117` |
| `app/admin/ediel/unresolved/page.tsx.before-lint-type-hotfix` | `2e9aa301568aea5176b0be0d9fa5403b0964aa30b1e97015a459157d8330a294` |
| `lib/ediel/routeProfileProductionReadiness.ts.before-lint-type-hotfix` | `77ed9448764c54e736037a5be3ab4d7e436cdfd9cd5a9ad95335aab5be60a135` |
| `lib/external-contracts/intake.ts.before-lint-type-hotfix` | `1d56b66a4db2959f24beaf7ac80ae6ebd58c4260e10c44f91588b5f86d7f8f73` |
| `lib/legal/gridOwnerLegalPayload.ts.before-lint-type-hotfix` | `a2f433993c87df2799b16bd9f9dc88ac0be1671aacecc735b480beb996294654` |
| `lib/metering/normalizeMeteringValues.ts.before-lint-type-hotfix` | `5ec1311d58bab9700cd0d1fcd29fd5f93f8cec84a374c0594099ce5816752e50` |

Backuper ska framåt hanteras i versionshistorik eller extern backup, inte som
runtime-nära källfiler.
