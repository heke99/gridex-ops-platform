# U23 — exact accepted POA document binding

Confirmed insertion-phase finding; recommended severity: P1 evidence integrity; no demonstrated cross-tenant access. A complete structured Website POA can reference a different published, locked power_of_attorney document in the same company instead of the document in the accepted offer bundle. The signed POA snapshot then represents different legal text from the application acceptance.

## Executed proof

`node quality/audits/2026-10-07-ops-api-review/evidence/remaining-poa-native-phase.mjs`

Seven assertions passed in isolated, in-memory PGlite PostgreSQL. Uses the unmodified native JSON row insertion helper from supabase/schema.sql70715–70753; the exact native POA insertion phase from75253–75282 wrapped in a fixture function; live normalization and materialization trigger definitions from poa-live-normalization-catalog.json. Added minimal synthetic legal tables and two legal reference FKs, and synthetic POA table defaults. Native command expects bundle B and document D; alternate E belongs to published/locked same-company bundle C. The insert succeeds, stores E, creates an immutable fullmakt_snapshot referencing E/C, and marks status signed. Positive exact D/B succeeds. Wrong tenant, wrong module, unlocked document, nonexistent document, and absent scope reject with expected PostgreSQL error codes.

This is a **native insertion-phase proof**, not execution of the full canonical onboarding graph and not a production reproduction. No postgres/psql/initdb executables were available. Full graph quote/reservation/pre/post steps and unrelated triggers were not installed. No customer data or production writes were used.

## Requirement and source chain

- docs/openapi/website-integration-v1.json11939–11943: textVersionId must use primary_document_id in exact accepted POA bundle.
- customerApplicationSchemas normalization331 and structured validation349–405 do not compare this legal ID.
- customerApplicationProcess819–836 calls canonical Website builder directly; ensureWebsitePowerOfAttorney comparison870–895 is only used by repair callers, not normal creation.
- customerApplicationOnboarding440–447 records offer legal versions in acceptance_snapshot;477 forwards caller textVersionId independently.
- Local native wrapper schema74678–74810 checks commercial quote selection. Quote commit wrapper75530–75669 checks contract/quote/offer legal_bundle_version_id, but does not inspect power_of_attorney legal reference.
- Local native core inserts caller POA payload using exact75253–75282 phase tested here.
- Live normalize checks tenant, module, locked state and compatibility reference. Live materializer checks publication, lock, variables and rendered content. Neither compares the POA document bundle to the contract/accepted legal bundle.
- Prior actual builder + actual native RPC wrapper probe passed3/3: website-poa-legal-binding.probe.ts and website-poa-legal-binding-tests.log.

## Safeguards and refutations

Cross-tenant, wrong-module, unlocked, nonexistent documents and missing scopes are rejected in this harness. The live compatibility normalization safely moves canonical document IDs out of legacy legal_text_version_id; therefore the initial default FK-failure hypothesis is refuted and must not be reported. Existing locks and materialization preserve immutable text; they do not establish that it was the accepted offer's text. This proof makes no claim about successful external sending or mail delivery. Downstream authoritative coverage may block incomplete captures, but the tested alternate document is complete, published, locked and materialized.

## Remaining boundary / recommended fix

Read-only live definitions of all four functions have now been reviewed in remaining-poa-live-functions.json. The deployed core POA insertion phase (definition lines435–462) is byte-identical to the executed fixture SQL, recorded in remaining-poa-live-refutation.json. canonical_onboard_customer_graph delegates at line37; gridex_onboard_customer_graph delegates at133 after commercial quote assertions. The quote commit wrapper compares quote and contract legal_bundle_version_id at100–101 and published offer bundle at120, then invokes core148; it never inspects the POA legal document. Core accepts v_poa_payload141 independently, inserts it445–462, and records the independently supplied legal bundle/acceptance snapshot505–518. Its later525 update only links legal_snapshot_id and does not compare document versions. No additional deployed exact-offer POA guard occurs in these four functions. Full live graph execution is intentionally not attempted, and unrelated table triggers remain outside the phase fixture. Enforce exact accepted POA document before Website writes and repeat the equality check in native onboarding against the accepted contract legal bundle. Keep current tenant/module/lock/FK guards. Add a contract-level test with two valid published locked same-company POA documents in different bundles. Reject alternate ID before committing signed evidence; test exact ID success and all existing rejection controls.

## Final classification

Confirmed: actual Website command/RPC boundary accepts conflicting exact POA ID; native insertion phase using the deployed expressions and live POA legal guards accepts and materializes the different valid same-company document. Deployed graph definitions do not add an exact POA/offer equality guard. This supports a source-backed system finding with a native phase reproduction. It does not claim full graph execution, production data occurrence, cross-tenant bypass, or externally sent output.
