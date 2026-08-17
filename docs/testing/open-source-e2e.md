# Gridex open-source E2E layer

Gridex keeps the existing domain/regression certificate as the source of truth for business logic. This layer adds the missing external test engines instead of duplicating that logic.

## Tools

- **Playwright 1.60.0**: real Chromium navigation, form interaction, traces, screenshots and videos on failure.
- **@axe-core/playwright 4.11.3**: automated WCAG A/AA checks inside the real browser flow.
- **Grafana k6 2.1.0**: low-volume staging performance smoke with explicit error-rate and latency thresholds.
- **OWASP ZAP baseline action 0.15.0**: passive staging DAST baseline. It reports findings but does not block releases until a reviewed Gridex baseline is established.

Versions are pinned by `scripts/install-browser-e2e-tooling.sh` and `.github/workflows/browser-quality-e2e.yml`. `scripts/gridex-open-source-e2e-tooling-regression.cjs` fails if this wiring disappears or drifts.

## CI modes

`browser-public` runs on pull requests and pushes to `main`. It starts the local Next.js application and verifies the public landing/login flow plus serious/critical WCAG violations.

Nightly/manual staging runs use these GitHub Actions secrets:

- `GRIDEX_E2E_BROWSER_BASE_URL`
- `GRIDEX_E2E_BROWSER_EMAIL`
- `GRIDEX_E2E_BROWSER_PASSWORD`

The staging browser test logs in through the actual UI and traverses dashboard, operations and customers. k6 and ZAP use the same staging base URL. Missing secrets skip scheduled staging checks but cause a manually requested staging run to fail clearly.

## Local browser run

```bash
npm ci
bash scripts/install-browser-e2e-tooling.sh
npx playwright test e2e/browser/public.spec.mjs --config=playwright.config.mjs
```

For authenticated staging:

```bash
export GRIDEX_E2E_BROWSER_BASE_URL='https://staging.example.com'
export GRIDEX_E2E_BROWSER_EMAIL='e2e-user@example.com'
export GRIDEX_E2E_BROWSER_PASSWORD='...'
npx playwright test --config=playwright.config.mjs
```

Do not use a production account or production URL for mutating E2E. The authenticated browser suite is intended for an isolated staging account only.
