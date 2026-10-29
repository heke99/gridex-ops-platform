// Synthetic tenant fixture for Track 4 (billing: invoice drafts -> approval -> invoice file).
//
// Every fixture step is tagged with its MECHANISM so reports and the README can say exactly what is a real
// product entrypoint and what is a direct SQL substitution:
//   auth-api   Supabase Auth admin API (GoTrue)            - real entrypoint of the platform's identity provider
//   sql        direct INSERT/UPDATE through psql            - SUBSTITUTION: bypasses product code; verifies nothing about it
//   api        the product's HTTP API / server action       - real entrypoint
//   compute    pure computation in the runner               - no system under test
//
// UNTESTED AGAINST THE STACK when this file was written (no stack access in the authoring session): the SQL
// inserts were derived from information_schema/constraint/trigger reading only. The first run is expected to
// surface constraint or trigger errors; each fixture step fails loudly with the SQLSTATE so it can be fixed
// as a HARNESS defect (not a product finding).
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { lit } from '../runner/lib/sql.mjs'
import { signIn } from '../runner/lib/session.mjs'
import { FIXTURE_MONTHS, FIXTURE_TERMS, computeExpected } from './expected.mjs'

const REQUIRED_PERMISSIONS = ['billing_underlay.read', 'billing_underlay.export']
const ROLE_KEY = 't4_billing_staff'

const digits = (n) => Array.from(randomBytes(n), (b) => b % 10).join('')

/** Month 'YYYY-MM' -> {year, month, start, end(exclusive)} */
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { year: y, month: m, start: `${month}-01`, end: `${next}-01` }
}

export function fixtureSteps() {
  return [
    {
      id: 'FX01', title: 'synthetic tenants A (with data) and B (empty, for cross-tenant probes)', scope: 'sql', mechanism: 'sql',
      note: 'SUBSTITUTION: companies are inserted directly; the product provisions tenants through platform-admin tooling (not exercised).',
      async run(ctx) {
        const tag = `${Date.now().toString(36)}${digits(3)}`
        const provider = process.env.T4_INVOICE_PROVIDER ?? 'file_export'
        const make = async (key, label, billing) => {
          const id = randomUUID()
          await ctx.sql.exec(`INSERT INTO public.companies(id,name,status,lifecycle_status${billing ? ',billing_provider_environment,invoice_export_target_system,invoice_export_enabled' : ''})
            VALUES (${lit(id)},${lit(`T4 Synthetic ${label} ${tag} AB`)},'active','active'${billing ? `,'test',${lit(provider)},true` : ''})`)
          return id
        }
        const fx = ctx.fixture
        fx.tag = tag
        fx.provider = provider
        fx.companyA = await make('a', 'Elhandel A', true)
        fx.companyB = await make('b', 'Elhandel B', true)
        ctx.value('companyA', fx.companyA); ctx.value('companyB', fx.companyB); ctx.value('provider', provider)
      },
    },
    {
      id: 'FX02', title: 'staff users in Supabase Auth with billing_underlay.read/.export via role, membership and user_roles', scope: 'api+sql', mechanism: 'auth-api+sql',
      note: 'Auth users: real Auth admin API. Role/permission/membership rows: SUBSTITUTION (canonical_authenticated_tenant_context reads company_memberships + user_roles + role_permissions; no tenant-admin UI is driven).',
      needs: ['FX01'],
      async run(ctx) {
        const fx = ctx.fixture
        const admin = createClient(ctx.env.NEXT_PUBLIC_SUPABASE_URL, ctx.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        const mkUser = async (label, companyId) => {
          const email = `t4-staff-${label}-${fx.tag}@example.invalid`
          const password = `T4-${randomBytes(12).toString('hex')}Aa1!`
          const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
          if (created.error) throw new Error(`auth admin createUser failed: ${created.error.message}`)
          const id = created.data.user.id
          await ctx.sql.exec(`
            INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES (${lit(id)},${lit(email)},${lit(`T4 staff ${label}`)},'active')
              ON CONFLICT (id) DO UPDATE SET user_status='active';
            INSERT INTO public.roles(key,name,description,scope,is_active) VALUES (${lit(ROLE_KEY)},'T4 billing staff','T4 simulation role','company',true)
              ON CONFLICT (key) DO NOTHING;
            INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
              SELECT r.id,r.key,p.id,p.key,'allow' FROM public.roles r JOIN public.permissions p ON p.key = ANY(${lit(`{${REQUIRED_PERMISSIONS.join(',')}}`)}::text[])
              WHERE r.key=${lit(ROLE_KEY)}
                AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);
            INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,role_id,status,is_active,joined_at,accepted_at,metadata)
              SELECT ${lit(companyId)},${lit(id)},'company_admin',r.key,r.id,'active',true,now(),now(),'{}'::jsonb FROM public.roles r WHERE r.key=${lit(ROLE_KEY)};
            INSERT INTO public.user_roles(user_id,company_id,role,role_id,status,is_active)
              SELECT ${lit(id)},${lit(companyId)},r.key,r.id,'active',true FROM public.roles r WHERE r.key=${lit(ROLE_KEY)};`)
          return { id, email, password }
        }
        fx.userA = await mkUser('a', fx.companyA)
        fx.userB = await mkUser('b', fx.companyB)
        const granted = await ctx.sql.rows(`SELECT permission_key FROM public.role_permissions WHERE role_key=${lit(ROLE_KEY)} ORDER BY 1`)
        ctx.assert.deepEqual(granted.map((r) => r.permission_key), [...REQUIRED_PERMISSIONS].sort(), 'role must carry exactly the two billing permissions')
        ctx.value('userA', fx.userA.id); ctx.value('userB', fx.userB.id)
      },
    },
    {
      id: 'FX03', title: 'customer, site, metering point, fixed-price contract, price snapshot, supply period (tenant A)', scope: 'sql', mechanism: 'sql (contract part: superuser, triggers bypassed)',
      note: 'SUBSTITUTION. customer/site/metering point: plain SQL (triggers active). Contract/snapshot/supply period: SQL as superuser with product triggers BYPASSED (session_replication_role=replica) because the product only creates signed/active contracts through the signature + activation commands (catalog offer, legal bundle, signed PDF, supply graph) and has no import command; see comment in seed.mjs.',
      needs: ['FX01'],
      async run(ctx) {
        const fx = ctx.fixture
        const c = fx.companyA
        const ids = { customer: randomUUID(), site: randomUUID(), mp: randomUUID(), contract: randomUUID(), snapshot: randomUUID(), supply: randomUUID() }
        const gsrn = `735999${digits(12)}`
        const T = FIXTURE_TERMS
        const baseComponents = [{ source_type: 'fixed', price_area: T.priceArea, weight_percent: 100, fixed_price_sek_per_kwh: Number(T.fixedOrePerKwh) / 100, label: 'Fastpris' }]
        const priceComponents = [{ component_type: 'fixed_monthly_fee', name: 'Fast månadsavgift', calculation_type: 'fixed_monthly', amount: Number(T.monthlyFeeSek), unit: 'sek_month', vat_applicable: true, lifecycle: 'recurring' }]
        const snapshotJson = { contract_type: 'fixed', pricing_model: 'fixed', price_area: T.priceArea, vat_rate: Number(T.vatRate) }
        // Part 1: customer, site, metering point - plain INSERTs, product triggers active.
        await ctx.sql.exec(`
          INSERT INTO public.customers(id,company_id,customer_type,status,first_name,last_name,full_name,name,email,customer_number,billing_street,billing_postal_code,billing_city,billing_country,invoice_email,is_test_data)
            VALUES (${lit(ids.customer)},${lit(c)},'private','active','Tora','T4Kund','Tora T4Kund','Tora T4Kund',${lit(`t4-kund-${fx.tag}@example.invalid`)},${lit(`T4-${fx.tag}`)},'Testvägen 1','41101','Göteborg','SE',${lit(`t4-faktura-${fx.tag}@example.invalid`)},true);
          INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,status,street,postal_code,city,price_area_code,site_type,is_test_data)
            VALUES (${lit(ids.site)},${lit(c)},${lit(ids.customer)},'T4 Anläggning',${lit(gsrn)},'active','Testvägen 1','41101','Göteborg',${lit(T.priceArea)},'consumption',true);
          INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,status,price_area_code,price_area,start_date,is_test_data)
            VALUES (${lit(ids.mp)},${lit(c)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},${lit(gsrn)},${lit(gsrn)},'active',${lit(T.priceArea)},${lit(T.priceArea)},${lit(T.contractStart)},true);`)
        // Part 2: signed/active contract, price snapshot, supply period.
        // BACKEND SUBSTITUTION with product triggers BYPASSED. The product has no import command: customer_contracts
        // rows with status signed/active can only come from the signature command (online signing: published offer ->
        // gridex_create_internal_customer_contract_v1 -> pending_signature -> signed with product/publication/legal-bundle
        // version and signature evidence -> activate_customer_supply_v1 with a supply graph). Driving that needs a
        // published catalog (contract_offers, price options, area prices, legal bundle version) and a signed PDF; not built.
        // So this runs as the local superuser (supabase_admin) with session_replication_role=replica (triggers AND FK
        // checks off, CHECK constraints still on). Verifies nothing about contract creation, signing, activation, quote /
        // publication binding or snapshot hash/area guards; the snapshot hash is computed here the way the integrity
        // trigger does (sha256 of snapshot_json::text). Catalog/evidence reference columns are left NULL.
        await ctx.sqlAdmin.exec(`
          SET session_replication_role = replica;
          INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,source_type,status,contract_name,contract_type,contract_number,
              fixed_price_ore_per_kwh,monthly_fee_sek,starts_at,actual_start_date,price_area_used,vat_rate,invoice_recipient,invoice_email,billing_street,billing_postal_code,billing_city,billing_country,
              signed_at,locked_at,signature_snapshot,signature_snapshot_sha256,lifecycle_stage,energy_direction,metadata)
            VALUES (${lit(ids.contract)},${lit(c)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},${lit(ids.mp)},'manual','active','T4 Fastpris','fixed',${lit(`T4-AVT-${fx.tag}`)},
              ${T.fixedOrePerKwh},${T.monthlyFeeSek},${lit(T.contractStart)},${lit(T.contractStart)},${lit(T.priceArea)},${T.vatRate},'Tora T4Kund',${lit(`t4-faktura-${fx.tag}@example.invalid`)},'Testvägen 1','41101','Göteborg','SE',
              ${lit(`${T.contractStart}T08:00:00Z`)},${lit(`${T.contractStart}T08:00:00Z`)},${lit({ t4_fixture: 'signature evidence is synthetic' })}::jsonb,repeat('a',64),'active','consumption',${lit({ t4_fixture: 'triggers bypassed' })}::jsonb);
          INSERT INTO public.contract_price_snapshots(id,company_id,contract_id,customer_id,pricing_model,base_price_components_snapshot,price_components_snapshot,snapshot_json,valid_from,snapshot_hash,source)
            VALUES (${lit(ids.snapshot)},${lit(c)},${lit(ids.contract)},${lit(ids.customer)},'fixed',${lit(baseComponents)}::jsonb,${lit(priceComponents)}::jsonb,${lit(snapshotJson)}::jsonb,${lit(T.contractStart)},repeat('0',64),'manual');
          UPDATE public.contract_price_snapshots SET snapshot_hash=encode(extensions.digest(convert_to(snapshot_json::text,'UTF8'),'sha256'),'hex') WHERE id=${lit(ids.snapshot)};
          UPDATE public.customer_contracts SET contract_price_snapshot_id=${lit(ids.snapshot)}, snapshot_hash=(SELECT snapshot_hash FROM public.contract_price_snapshots WHERE id=${lit(ids.snapshot)}) WHERE id=${lit(ids.contract)};
          INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,actual_start_date,status,source)
            VALUES (${lit(ids.supply)},${lit(c)},${lit(ids.customer)},${lit(ids.mp)},${lit(ids.contract)},${lit(ids.contract)},${lit(T.contractStart)},${lit(T.contractStart)},'active','manual');`)
        Object.assign(fx, { ids, gsrn })
        const snap = await ctx.sql.one(`SELECT snapshot_hash, snapshot_schema_version FROM public.contract_price_snapshots WHERE id=${lit(ids.snapshot)}`)
        ctx.value('snapshot', snap)
        ctx.assert.match(snap.snapshot_hash, /^[0-9a-f]{64}$/, 'snapshot hash')
        ctx.assert.notEqual(snap.snapshot_hash, '0'.repeat(64))
        ctx.value('gsrn', gsrn)
      },
    },
    {
      id: 'FX04', title: 'meter values for the billing months -> READY billing underlays', scope: 'sql', mechanism: 'sql (default) | api generate-underlay (T4_UNDERLAY_MODE=engine)', needs: ['FX03'],
      note: 'SUBSTITUTION in default mode: underlays are inserted as validated/ready with total_kwh set, bypassing meter-value intake and generateBillingUnderlaysForMonth. Billable meter values need a genuine inbound UTILTS E66 message (gridex_read_billing_source_values_v1 -> basis_v1 verifies the Ediel source message, stored consumer contract and rule-pack basis), which this fixture does not create. TODO(T4-FX04b): seed that through the inbound Ediel path, then use T4_UNDERLAY_MODE=engine (POST /api/internal/billing/generate-underlay).',
      async run(ctx) {
        const fx = ctx.fixture
        const mode = process.env.T4_UNDERLAY_MODE ?? 'direct'
        ctx.value('mode', mode)
        if (mode === 'engine') {
          const session = await ensureSession(ctx, 'A')
          for (const m of Object.values(FIXTURE_MONTHS)) {
            const res = await ctx.http.post('/api/internal/billing/generate-underlay', { cookie: session.cookie(), json: { billing_month: m.month }, label: `generate-underlay ${m.month}` })
            ctx.assert.equal(res.status, 200, `generate-underlay ${m.month}`)
          }
          const ready = await ctx.sql.scalar(`SELECT count(*) FROM public.billing_underlays WHERE company_id=${lit(fx.companyA)} AND status='validated' AND readiness_status='ready'`)
          ctx.assert.equal(Number(ready), Object.keys(FIXTURE_MONTHS).length, 'engine mode: every month needs a validated/ready underlay (requires UTILTS-qualified meter values: TODO T4-FX04b)')
          return
        }
        fx.underlays = {}
        for (const [key, m] of Object.entries(FIXTURE_MONTHS)) {
          const b = monthBounds(m.month)
          const id = randomUUID()
          await ctx.sql.exec(`
            INSERT INTO public.billing_underlays(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,pricing_snapshot_id,contract_price_snapshot_id,supply_period_id,
                underlay_year,underlay_month,billing_period_start,billing_period_end,status,readiness_status,total_kwh,currency,source_system,source_meter_value_count,missing_values_count,price_area,vat_rate,energy_direction,settlement_type,payload)
              VALUES (${lit(id)},${lit(fx.companyA)},${lit(fx.ids.customer)},${lit(fx.ids.site)},${lit(fx.ids.site)},${lit(fx.ids.mp)},${lit(fx.ids.contract)},${lit(fx.ids.contract)},${lit(fx.ids.snapshot)},${lit(fx.ids.snapshot)},${lit(fx.ids.supply)},
                ${b.year},${b.month},${lit(b.start)},${lit(b.end)},'validated','ready',${m.kwh},'SEK','manual',${24 * 30},0,${lit(FIXTURE_TERMS.priceArea)},${FIXTURE_TERMS.vatRate},'consumption','invoice',
                ${lit({ billing_month: m.month, generated_from: 't4_fixture_direct' })}::jsonb)`)
          fx.underlays[key] = id
        }
        ctx.value('underlays', fx.underlays)
      },
    },
    {
      id: 'FX05', title: 'expected invoice amounts computed independently (oracle candidate)', scope: 'compute', mechanism: 'compute', needs: ['FX01'],
      note: 'See fixtures/expected.mjs for the rounding rule found in code; it is an ORACLE CANDIDATE.',
      async run(ctx) {
        ctx.fixture.expected = {}
        for (const [key, m] of Object.entries(FIXTURE_MONTHS)) {
          ctx.fixture.expected[key] = computeExpected({ kwh: m.kwh })
          if (!ctx.fixture.expected[key].variants_agree.exact_vs_float) ctx.finding(`oracle candidate: exact decimal and the product's float formula differ for ${m.month}`)
          if (!ctx.fixture.expected[key].variants_agree.per_line_vs_on_total) ctx.finding(`oracle candidate: VAT per line and VAT on total differ for ${m.month}`)
        }
        ctx.value('expected', ctx.fixture.expected)
      },
    },
    {
      id: 'FX06', title: 'staff sessions (cookies incl. active-company cookie) for tenants A and B', scope: 'api', mechanism: 'api (Supabase Auth password sign-in)', needs: ['FX02'],
      async run(ctx) {
        const a = await ensureSession(ctx, 'A')
        const b = await ensureSession(ctx, 'B')
        // The canonical tenant context must grant exactly the intended permissions to each user for its own company.
        for (const [label, s, company] of [['A', a, ctx.fixture.companyA], ['B', b, ctx.fixture.companyB]]) {
          const user = createClient(ctx.env.NEXT_PUBLIC_SUPABASE_URL, ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.accessToken}` } } })
          const { data, error } = await user.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: company })
          ctx.assert.ifError(error)
          ctx.assert.equal(data.authorized, true, `tenant context authorized for ${label}`)
          ctx.assert.equal(data.selected_company_id, company, `selected company for ${label}`)
          for (const p of REQUIRED_PERMISSIONS) ctx.assert.ok(data.permissions.includes(p), `${label} lacks ${p}`)
        }
        // The admin page itself must open for A (guards: billing.workspace -> billing_underlay.read).
        const page = await ctx.http.get(`/admin/billing?month=${FIXTURE_MONTHS.main.month}`, { cookie: a.cookie(), label: 'GET /admin/billing (fixture check)' })
        ctx.assert.equal(page.status, 200, 'GET /admin/billing as staff A')
      },
    },
  ]
}

/** Sign in once per tenant label ('A'|'B') and cache the session on the fixture. */
export async function ensureSession(ctx, label) {
  const fx = ctx.fixture
  fx.sessions ??= {}
  if (!fx.sessions[label]) {
    const user = label === 'A' ? fx.userA : fx.userB
    const company = label === 'A' ? fx.companyA : fx.companyB
    fx.sessions[label] = await signIn({ url: ctx.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, email: user.email, password: user.password, companyId: company })
  }
  return fx.sessions[label]
}
