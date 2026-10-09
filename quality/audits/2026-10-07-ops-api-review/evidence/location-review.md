# OPS partner location requirement evidence

Scope: read-only code audit at local HEAD 1aef94be4758260e134bdc195a69312901bf8cb2. No source fix, live business API call, customer data or production mutation. Actual handler and actual resolver executed with synthetic DB/auth/event ports. This proves branching/output semantics, not production geographic coverage or deployed revision behavior.

Activated inherited spec-to-code-compliance, code-review and fp-check workflow for two bounded requirements. Audit evidence isolated from shared Ediel memory. Findings below require independent parent refutation before promotion.

## Candidate L1: stale geographic results projected as resolved/verified (P2)

Trigger: GET /api/partner/v1/location?postal_code=12345&address=Synthetic%201&city=Synthetic. Cached exact address resolves through polygon to complete SE3/grid area/owner; latest verified geodata timestamp older than max age (default30days).

Root: resolver.ts651–671 calculates staleness; pointToGridArea710–728 deliberately preserves identifiers, priceArea and resolutionStatus=grid_area_master_validated but changes assurance to unresolved and disables automation. saveResolution1087 records unresolved assurance; business.ts172–195 discards assurance status except ambiguous and decides resolved/verified from identifier presence.

Proof: actual realresolver/handler probe saves unresolved assurance and automation_allowed=false then returns200 location.status=resolved, grid_area.verified=true, grid_owner.verified=true. Same fixture GET/price/current422 location_not_resolved. Fresh complete control200 resolves and validates. Impact: consumer selecting by structured status/verified flags can present a stale unverified SE area as confirmed; warnings correctly retain svk_geodata_stale_or_unverified. This does not bypass price-readiness, native materialization or Ediel dispatch guards. Do not infer grid_owner.verified must equal operational PRODAT readiness: geographic identity and operational routing intentionally separate.

Target fix: expose price_area_assurance_status/geodata freshness and derive location success classification from usable assurance; preserve last-known identifiers explicitly as provisional and document verified flag semantics. Avoid claiming all stale data is actually wrong.

## Candidate L2: valid null location data violates published OpenAPI3.1 (P2)

Root: partnerOpenApi.openapi is3.1.0 (openApi.ts25); businessOpenApi.ts36–37 and126–142 uses nullable:true with type:string/object, including price_area enumSE1–SE4. OpenAPI3.1 JSONSchema type does not admit null merely from nullable:true. No nullable projection or3.0 document wrapper occurs in actual exported schema.

Proof: actual realresolver/handler postal-only200partial includes city:null and grid_area.name:null, provisional owner/area verified:false. Actual full fresh200 can also emit grid_area.name:null. Both rejected by shared JSONSchema type semantics with installed Ajv6 default nullable disabled; valid complete fresh control accepted. Ajv6 is not a full OpenAPI3.1 validator: test covers only type/additionalProperties/ref semantics shared with2020-12; therefore no claim of comprehensive schema compliance. Actual ambiguous postal409 returns price_area:null in error.location and refuses guessing (positive control), not200 LocationResponse.

Impact: standards-based response validation and generated clients can reject normal successful partial location outputs. Replace nullable with type unions includingnull; include null in relevant enums or anyOf. Review equivalent nullable price component fields as same schema class, not independently proven handler findings here.

## Verification

Command: /tmp/gridex-api-review-node22/node_modules/.bin/node node_modules/vitest/vitest.mjs run __tests__/audit-location-output.test.ts
Outcome:6/6PASS, one file,626ms. Probe archived to location-output.probe.ts, test log location-output-tests.log; temporary executable suite removed after completion. Tests cover freshvalid, stalecontradiction, stalecurrentpriceguard, optionalnullname, postalpartialprovisional/schema, postalambiguousguard. No fullapp/build/scanners or realpolygon dataset accuracy test performed.
