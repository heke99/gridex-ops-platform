# Gridex OPS hardening patch v5

This patch supersedes v1-v4 and includes all previously supplied hotfixes, including:

- system-health `companyId` propagation
- billing webhook result/auth typing
- facility request `siteAddressHash` narrowing
- normalized metering result typo (`meteringValue` -> `meterValue`)

## Verification

- Full project typecheck passed with TypeScript native preview across 1,039 TypeScript files.
- ESLint passed for all 59 changed executable TypeScript/JavaScript files.
- `git diff --check` passed.
- Gridex static hardening audit passed.
- Migration integrity/checksums passed for 254 SQL files / 159 version groups.
- Full Next production build did not complete inside the container runtime; run `npm run build` locally/CI before merge.

## Sync from patch into an existing project

Run from the project root (the directory containing `package.json`):

```bash
rsync -av --itemize-changes \
  --backup \
  --suffix=.before-gridex-hardening-v5 \
  /ABSOLUTE/PATH/gridex-ops-256-hardening-runtime-patch-2026-07-12-v5/project-files/ \
  ./
```

Then verify:

```bash
git status --short
npm ci
npx -y @typescript/native-preview --noEmit -p tsconfig.app.json --pretty false
npx eslint $(cat /ABSOLUTE/PATH/gridex-ops-256-hardening-runtime-patch-2026-07-12-v5/CHANGED_FILES.txt | grep -E '\.(ts|tsx|js|mjs|cjs)$')
node scripts/gridex-hardening-static-audit.cjs
npm run db:migrations:check
npm run build
```

Do not run the new migration directly in production. Apply it first to a production-like staging copy with outbound email, Ediel, supplier-switch and invoice export frozen.
