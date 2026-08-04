'use client'

import { useActionState } from 'react'
import {
  createIntegrationApiClientAction,
  type CreateApiClientState,
} from './actions'
import { INTEGRATION_API_PERMISSION_GROUPS, recommendedPermissionGroups } from '@/lib/integrations/apiClientScopes'
import { WEBSITE_INTEGRATION_BASE_URL, WEBSITE_INTEGRATION_OPENAPI_URL } from '@/lib/integrations/websiteIntegrationContract'

type CompanyOption = {
  id: string
  name: string
  status: string | null
}

const INITIAL_STATE: CreateApiClientState = {
  ok: false,
  message: '',
}

const DEFAULT_PERMISSION_GROUPS = new Set(recommendedPermissionGroups())

export default function CreateApiClientForm({ companies }: { companies: CompanyOption[] }) {
  const [state, formAction, pending] = useActionState(createIntegrationApiClientAction, INITIAL_STATE)

  return (
    <div className="rounded-[32px] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Ny API-klient</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Koppla hemsida och Mina sidor</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Skapa en enda server-side API-nyckel för hemsida, teckning och Mina sidor. Tenantens produktion behöver bara miljövariabeln GRIDEX_API_KEY; tenant, company_id, base-URL och payloadläge ska inte konfigureras separat.
        </p>
      </div>

      {state.message ? (
        <div className={`mt-5 rounded-2xl border p-4 text-sm ${state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <p className="font-semibold">{state.message}</p>
          {state.readinessBlockers?.length ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-800">Blockerar lansering</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-red-800">
                {state.readinessBlockers.map((blocker: string) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          ) : null}
          {state.readinessWarnings?.length ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Varningar</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-800">
                {state.readinessWarnings.map((warning: string) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : null}
          {state.token ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Token · visas bara en gång</p>
              <code className="mt-2 block break-all rounded-xl bg-slate-950 p-3 text-xs text-emerald-100">{state.token}</code>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Lägg den som enda Gridex-secret: <strong>GRIDEX_API_KEY</strong>. Använd <strong>Authorization: Bearer &lt;GRIDEX_API_KEY&gt;</strong> mot <strong>{WEBSITE_INTEGRATION_BASE_URL}</strong>. OpenAPI finns på <strong>{WEBSITE_INTEGRATION_OPENAPI_URL}</strong>.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="mt-6 grid gap-5">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Bolag</span>
          <select name="companyId" required className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900">
            <option value="">Välj bolag</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}{company.status ? ` (${company.status})` : ''}</option>
            ))}
          </select>
        </label>

        <div className="grid gap-5 lg:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-800">Namn</span>
            <input name="name" defaultValue="Hemsida · Mina sidor" required className="rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-800">Rate limit/minut</span>
            <input name="rateLimitPerMinute" type="number" min="1" max="5000" defaultValue="120" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
          </label>
        </div>

        <input type="hidden" name="frontendApp" value="Tenantens hemsida" />
        <input type="hidden" name="intendedUse" value="gridex_customer_portal" />

        <fieldset className="rounded-3xl border border-slate-200 p-4">
          <legend className="px-2 text-sm font-semibold text-slate-800">Behörigheter i vanliga ord</legend>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Standardpaketet provisioneras på samma API-nyckel. Scopes styrs i OPS och är inte miljövariabler hos tenant. Tekniska scopes visas endast för administration och felsökning.
          </p>
          <div className="mt-3 grid gap-3">
            {INTEGRATION_API_PERMISSION_GROUPS.map((group) => (
              <label key={group.groupKey} className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  name="permissionGroups"
                  value={group.groupKey}
                  defaultChecked={DEFAULT_PERMISSION_GROUPS.has(group.groupKey)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{group.label}</span>
                  <span className="block text-xs leading-5 text-slate-600">{group.description}</span>
                  <span className="mt-1 block text-[11px] font-mono text-slate-500">{group.scopes.join(', ')}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Mina sidor URL</span>
          <input
            name="customerPortalUrl"
            type="url"
            required
            placeholder="https://tenant.example/mina-sidor"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          />
          <span className="text-xs text-slate-500">Obligatorisk tenantunik HTTPS-adress. Kundmail får aldrig falla tillbaka till OPS-adminens inloggning.</span>
        </label>

        <div className="grid gap-5 lg:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-800">Tillåtna domäner/origins</span>
            <textarea
              name="allowedOrigins"
              rows={4}
              placeholder={'https://tenant.example\nhttps://www.tenant.example'}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
            />
            <span className="text-xs text-slate-500">En per rad. Lämna tomt endast för ren server-to-server utan Origin-header.</span>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-800">Tillåtna IP-adresser</span>
            <textarea name="allowedIps" rows={4} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
            <span className="text-xs text-slate-500">Valfritt. Använd endast om tenantens webbplats har stabil outbound-IP.</span>
          </label>
        </div>


        <fieldset className="rounded-3xl border border-slate-200 p-4">
          <legend className="px-2 text-sm font-semibold text-slate-800">Webhook till extern hemsida</legend>
          <div className="mt-2 grid gap-5">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-800">Webhook URL</span>
              <input
                name="webhookUrl"
                type="url"
                placeholder="https://example.se/api/gridex/webhook"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              />
              <span className="text-xs text-slate-500">Valfritt. Används när kundplattformen ska skicka events tillbaka till hemsidan.</span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-800">Events att prenumerera på</span>
              <textarea
                name="webhookEventTypes"
                rows={6}
                defaultValue={'customer.created\ncustomer.updated\ncustomer_number.assigned\ncontract.application_received\ncontract.confirmation_sent\ncontract.cooling_off_sent\ninvoice.created\ninvoice.sent\ninvoice.disputed\nmetering_values.updated'}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-mono"
              />
              <span className="text-xs text-slate-500">En eventtyp per rad. Använd * endast för intern testmiljö.</span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-800">Signing secret reference</span>
              <input
                name="webhookSigningSecretRef"
                placeholder="GRIDEX_WEBSITE"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              />
              <span className="text-xs text-slate-500">Valfritt. Om satt signeras webhooks med WEBHOOK_SIGNING_SECRET_&lt;REF&gt; i servermiljön. Annars används platform fallback om den finns.</span>
            </label>
          </div>
        </fieldset>

        <div className="grid gap-5 lg:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-800">Giltig till</span>
            <input name="expiresAt" type="date" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-800">Intern anteckning</span>
            <input name="notes" placeholder="Ex. används av gridex.se Mina sidor" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
          </label>
        </div>

        <button disabled={pending} className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Skapar API-klient…' : 'Skapa API-klient och visa token'}
        </button>
      </form>
    </div>
  )
}
