# Karin Holm: ordinary support scenario

The runner at `scripts/demo/elklart-support-scenario.mjs` drives the real local OPS browser forms. It creates the fictional Karin customer through **Kundintag**, then uses a separate scoped **Kundtjänst** account for a support case, an internal phone log, an internal note and a public customer reply. It never calls SQL, rewrites a customer status or posts directly to server-action endpoints.

Prerequisites: the root-owned dedicated OPS runtime must be ready at `https://localhost:3000`, with private `ops/tenant.json`, `ops/status.json`, `ops/accounts.json`, and its own TLS certificate. Accounts must include the scoped `administrator` (`company_admin`) and `support` (`customer_service_agent`). The existing `handler` operations role does not have support permissions and is intentionally not repurposed. Customer creation uses administrator; actual support writes use the customer-service identity in a fresh browser context.

Run only after the runtime owner signals readiness:

```sh
ELKLART_SUPPORT_SCENARIO_ACK=ordinary-local-support-only \
  node scripts/demo/elklart-support-scenario.mjs
```

The runner pins the runtime certificate's exact SPKI and permits only the local OPS and local Supabase browser origins. It requires the fictional tenant and validates the form's expected company before support writes. Credentials are read from the private runtime and are never printed or included in evidence.

Private outputs, owned by this scenario:

- `/workspace/elklart-runtime/ops/support-scenario.json`: run, tenant, returned customer/case/actor IDs and stage receipt.
- `/workspace/elklart-runtime/ops/support-scenario.png`: final staff UI.
- `/workspace/elklart-runtime/ops/support-scenario-blocked.png`: private screenshot when an ordinary boundary fails.

No shared `fixtures.json` or `accounts.json` is changed. The runtime snapshot owner must include the private receipt in its allowlist, since it binds resumptions to the original IDs. Stop the runner before snapshot or reset. An ambiguous customer/case or mismatched saved ID stops the scenario. Existing exact message markers are checked in the staff history before another write, so an uncertain action response is reconciled before retry.

The call is explicitly **unverified, limited intake**, and discloses no account data. The public reply acknowledges receipt of the generic invoice question; it does not invent a completed investigation or a real invoice. The internal markers and phone log must remain internal; the public reply must be labelled customer-visible in staff UI.

**Scope of evidence:** staff UI read-back proves the ordinary case/conversation actions, including their saved visibility labels. It does not prove customer portal visibility or an issued invoice. Both remain `NOT_RUN`/unlinked in the receipt until the customer has a real portal identity linked through the ordinary flows and the portal journey verifies that only the reply is visible. No portal success is inferred from a staff label.

Targeted unit guards:

```sh
node node_modules/vitest/vitest.mjs run __tests__/elklart-support-scenario.test.ts
```

After staff UI passes and the runtime owner confirms the isolated portal/assertion provider is ready, run the ordinary customer boundary:

```sh
ELKLART_SUPPORT_SCENARIO_ACK=ordinary-local-support-only \
  node scripts/demo/elklart-support-scenario.mjs --portal
```

It reads Karin's actual customer number from her OPS customer card, registers `karin.holm@elklart.example.invalid` through the public registration page, logs in from a fresh portal browser context, and submits the normal existing-customer link form. It then opens **Mina supportärenden**, requires the exact public reply and rejects either internal marker. `portalVisibility=PASS` is recorded only after that customer-side read-back; an OPS fallback banner is a failure.

The portal account credential is generated and retained only at private `/workspace/elklart-runtime/portal/karin-support-account.json`, owned solely by this scenario. Include it in the runtime snapshot allowlist. No shared portal account/fixture path is edited. A registration attempt is recorded before submit: uncertain registration is reconciled through login rather than blindly registered again. Portal evidence is saved privately to `ops/support-scenario-portal.png` or `ops/support-scenario-portal-blocked.png`. No login/register screenshot containing credentials is taken.

## Actual local execution checkpoint

On the prepared local runtime, ordinary Karin intake and all three support writes passed staff UI read-back under `customer_service_agent`. The first attempts exposed missing source helper ACL and correction-producer reference prerequisites; the runtime owner restored those from source before the successful retry. No business status was patched to get through the scenario.

Karin's ordinary public portal registration also passed and fresh password login completed. The customer API then returned `403 organization_onboarding` from `/api/v1/customer/portal-bundle`; customer link and reply visibility remain **BLOCKED**, not passed. Root paused browser actions before coordinated snapshot/restore work. Preserve the actual private receipt and account file with that snapshot; registration must not be repeated blindly. This checkpoint makes no actual-invoice or customer-side visibility claim.
