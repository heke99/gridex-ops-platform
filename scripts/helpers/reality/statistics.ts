// Reality scenario K ("statistics are computed and shown correctly"): independent counts straight from the
// business tables, readers for the numbers the admin and white-label pages show, and the white-label platform
// as production has it. Synthetic data only (E2E-, example.invalid). Read-only except the explicit parity and
// white-label setup functions.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { literal, sql } from '../live-chain-fixture'

/** Months as YYYY-MM and their Stockholm bounds, relative to a Swedish calendar date. */
export function stockholmMonths(today: string) {
  const [year, month] = today.split('-').map(Number)
  const shift = (offset: number) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const lastDay = (key: string) => {
    const [y, m] = key.split('-').map(Number)
    return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  }
  return { current: shift(0), last: shift(-1), beforeLast: shift(-2), next: shift(1), later: shift(3), lastDay }
}

export const swedishToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })

export type IndependentMonth = {
  month: string
  customers: number; contracts: number; sites: number; meteringPoints: number
  activeStart: number; activeEnd: number; newCustomers: number; churned: number; activePointsEnd: number; activeSitesEnd: number
  poaCreated: number; poaSigned: number; poaValidEnd: number
  ongoingSwitches: number; valuesCurrent: number; valuesInMonth: number; missingPoints: number
}

/**
 * Every statistic of one tenant and Swedish month, computed here from the business tables without any platform
 * statistics function or view. Definitions (owner semantics, see FINDINGS K):
 *  - customers: the tenant's customers except test-portal (source ediel_portal_test) and hidden statuses
 *    (archived, deleted, deleted_test_only, pending_deletion), like the dashboard's "Kunder";
 *  - supply: customer_supply_periods not cancelled; a received end (market_end_at at the start of its date) is the
 *    first day no longer supplied, any other end date is the last supplied day (lib/billing/supplyPeriodEnd.ts);
 *  - active at a month boundary (the 1st of a month): supplied on the day before AND on the 1st (any period, so a
 *    move without a gap stays active); month start = the month's 1st, month end = the next month's 1st. So
 *    activeEnd(M) = activeStart(M+1), a customer churned in M is not active at its end, one starting on the 1st is
 *    new and not active at the start, and activeEnd - activeStart = new - churned apart from re-entries;
 *  - new: first supply day in the month; churned: the customer's last supply ends and its LAST SUPPLY DAY falls in
 *    the month (owner decision 2026-10-23, FINDINGS K-06; gridex_supply_period_last_day_v1, card "Sista
 *    leveransdag i månaden"): a switch away on the 1st (Z05 end_date = the 1st) is churned in the previous month;
 *  - powers of attorney: created/signed in the Swedish month, valid at month end (signed status, validity dates);
 *  - ongoing switches: open (draft, queued, prepared, submitted, …) or confirmed with supply not yet started;
 *  - values: current consumption rows; in the month by Stockholm period_start;
 *  - missing: an active metering point supplied (some day) in the month without any current value in it.
 */
export function independentMonth(companyId: string, month: string, today: string): IndependentMonth {
  const company = literal(companyId)
  const suppliedOn = (match: string, day: string) => `EXISTS (SELECT FROM sp x WHERE ${match} AND x.start_date<=${day} AND (x.stop IS NULL OR x.stop>${day}))`
  const atBoundary = (match: string, day: 'ms' | 'me') => `${suppliedOn(match, `${day}-1`)} AND ${suppliedOn(match, day)}`
  return sql<IndependentMonth>(`WITH b AS (SELECT ${literal(`${month}-01`)}::date ms, (${literal(`${month}-01`)}::date + interval '1 month')::date me,
      (${literal(`${month}-01`)}::date::timestamp AT TIME ZONE 'Europe/Stockholm') f, ((${literal(`${month}-01`)}::date + interval '1 month')::timestamp AT TIME ZONE 'Europe/Stockholm') t),
    sp AS (SELECT customer_id, metering_point_id, start_date,
        CASE WHEN coalesce(actual_end_date,end_date) IS NULL THEN NULL
             WHEN market_end_at IS NOT NULL AND market_end_at <= (coalesce(actual_end_date,end_date)::timestamp AT TIME ZONE 'Europe/Stockholm') + interval '1 hour' THEN coalesce(actual_end_date,end_date)
             ELSE coalesce(actual_end_date,end_date) + 1 END AS stop
      FROM public.customer_supply_periods WHERE company_id=${company} AND status<>'cancelled'),
    spans AS (SELECT customer_id, min(start_date) first_start, CASE WHEN bool_or(stop IS NULL) THEN NULL ELSE max(stop) END last_stop FROM sp GROUP BY 1),
    cu AS (SELECT id FROM public.customers WHERE company_id=${company} AND coalesce(source,'')<>'ediel_portal_test'
      AND coalesce(status,'') NOT IN ('archived','deleted','deleted_test_only','pending_deletion'))
    SELECT jsonb_build_object('month',${literal(month)},
      'customers',(SELECT count(*) FROM cu),
      'contracts',(SELECT count(*) FROM public.customer_contracts WHERE company_id=${company}),
      'sites',(SELECT count(*) FROM public.customer_sites WHERE company_id=${company}),
      'meteringPoints',(SELECT count(*) FROM public.metering_points WHERE company_id=${company}),
      'activeStart',(SELECT count(*) FROM (SELECT DISTINCT customer_id k FROM sp) c, b WHERE ${atBoundary('x.customer_id=c.k', 'ms')}),
      'activeEnd',(SELECT count(*) FROM (SELECT DISTINCT customer_id k FROM sp) c, b WHERE ${atBoundary('x.customer_id=c.k', 'me')}),
      'activePointsEnd',(SELECT count(*) FROM (SELECT DISTINCT metering_point_id k FROM sp) c, b WHERE ${atBoundary('x.metering_point_id=c.k', 'me')}),
      'activeSitesEnd',(SELECT count(*) FROM (SELECT DISTINCT coalesce(mp.customer_site_id,mp.site_id) k FROM sp JOIN public.metering_points mp ON mp.id=sp.metering_point_id) c, b
        WHERE c.k IS NOT NULL AND ${atBoundary(`x.metering_point_id IN (SELECT id FROM public.metering_points WHERE company_id=${company} AND coalesce(customer_site_id,site_id)=c.k)`, 'me')}),
      'newCustomers',(SELECT count(*) FROM spans, b WHERE first_start>=ms AND first_start<me),
      'churned',(SELECT count(*) FROM spans, b WHERE last_stop-1>=ms AND last_stop-1<me),
      'poaCreated',(SELECT count(*) FROM public.powers_of_attorney, b WHERE company_id=${company} AND created_at>=f AND created_at<t),
      'poaSigned',(SELECT count(*) FROM public.powers_of_attorney, b WHERE company_id=${company} AND signed_at>=f AND signed_at<t),
      'poaValidEnd',(SELECT count(*) FROM public.powers_of_attorney, b WHERE company_id=${company} AND status IN ('signed','accepted','active','completed')
        AND coalesce(valid_from,(signed_at AT TIME ZONE 'Europe/Stockholm')::date,(created_at AT TIME ZONE 'Europe/Stockholm')::date)<=me-1 AND (valid_to IS NULL OR valid_to>=me-1)),
      'ongoingSwitches',(SELECT count(*) FROM public.supplier_switch_requests s WHERE s.company_id=${company} AND (
        s.status IN ('draft','queued','prepared','submitted','pending','ready','in_progress','sent','waiting_response','awaiting_confirmation','cancellation_requested','cancellation_sent','manual_followup_required')
        OR (s.status IN ('accepted','confirmed') AND NOT EXISTS (SELECT FROM public.customer_supply_periods x WHERE x.company_id=s.company_id AND x.source_switch_request_id=s.id
          AND x.status<>'cancelled' AND x.start_date<=${literal(today)}::date)))),
      'valuesCurrent',(SELECT count(*) FROM public.metering_values WHERE company_id=${company} AND coalesce(is_current,true)),
      'valuesInMonth',(SELECT count(*) FROM public.metering_values v, b WHERE v.company_id=${company} AND v.metering_point_id IS NOT NULL AND coalesce(v.is_current,true)
        AND coalesce(v.reading_type,'consumption')='consumption' AND coalesce(v.value_kwh,v.quantity_kwh,v.quantity) IS NOT NULL AND v.period_start>=f AND v.period_start<t),
      'missingPoints',(SELECT count(*) FROM public.metering_points p, b WHERE p.company_id=${company} AND lower(coalesce(p.status,'')) IN ('active','live','ongoing')
        AND NOT EXISTS (SELECT FROM public.customers c WHERE c.id=p.customer_id AND c.source='ediel_portal_test')
        AND EXISTS (SELECT FROM sp WHERE sp.metering_point_id=p.id AND sp.start_date<me AND (sp.stop IS NULL OR sp.stop>ms))
        AND NOT EXISTS (SELECT FROM public.metering_values v WHERE v.company_id=${company} AND v.metering_point_id=p.id AND coalesce(v.is_current,true) AND v.period_start>=f AND v.period_start<t)))`)
}

/** A shown number as the admin pages format it (sv-SE: non-breaking spaces, U+2212 minus, explicit +). */
export function shownNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const normalized = text.replace(/−/g, '-').replace(/[\s  +]/g, '')
  const match = /^-?\d+(?:,\d+)?/.exec(normalized)
  return match ? Number(match[0].replace(',', '.')) : null
}

/** label → shown value for every card or line whose label is exactly one of `labels` (first occurrence). */
/** The admin pages stream: `main` first holds the loading skeleton (`aria-busy`); read only once it is gone (T34). */
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), null, { timeout: 120_000 })
}

export async function readLabelledValues(page: Page, labels: string[]): Promise<Record<string, string | null>> {
  await settled(page)
  return page.evaluate((wanted) => {
    const found: Record<string, string | null> = Object.fromEntries(wanted.map(label => [label, null]))
    for (const element of Array.from(document.querySelectorAll('main p, main div, main span'))) {
      const own = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? '').join('').trim()
      if (!own || !(own in found) || found[own] !== null || element.children.length > 0) continue
      const value = element.nextElementSibling?.textContent?.trim()
      if (value) found[own] = value
    }
    return found
  }, labels)
}

/** Every row of the first table on the page: header text → cell text, plus the row's link query parameters. */
export async function readTable(page: Page): Promise<Array<Record<string, string>>> {
  await settled(page)
  return page.evaluate(() => {
    const table = document.querySelector('main table')
    if (!table) return []
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => (th.textContent ?? '').trim())
    return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'))
      const row: Record<string, string> = Object.fromEntries(headers.map((header, i) => [header, (cells[i]?.textContent ?? '').trim()]))
      const href = tr.querySelector('a')?.getAttribute('href')
      if (href) for (const [key, value] of new URL(href, location.origin).searchParams) row[`@${key}`] = value
      return row
    })
  })
}

/** A Supabase client signed in as a user (the user's own JWT, so RLS and the RPCs' own checks apply). */
export async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw Error('statistics_supabase_env_required')
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw Error(`statistics_sign_in_failed:${email}:${error.message}`)
  return client
}

/**
 * Replay vs production drift (FINDINGS F47, K-B1): production has white_label_platforms and
 * white_label_platform_memberships (20260521_actor_testing_go_live_module.sql) and companies.white_label_platform_id;
 * the canonical replay has none, so no white-label page or RPC can run. Mirrors the two tables exactly (columns,
 * constraints, indexes) when they are missing. Their RLS is not needed: the portfolio RPCs are SECURITY DEFINER.
 */
export function ensureProductionWhiteLabelPlatformParity() {
  if (sql<boolean>(`SELECT to_regclass('public.white_label_platform_memberships') IS NOT NULL`)) return
  sql(`create table if not exists public.white_label_platforms (
      id uuid primary key default gen_random_uuid(), name text not null, slug text unique, status text not null default 'active',
      support_email text null, billing_email text null, metadata jsonb not null default '{}'::jsonb,
      created_by uuid null references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      constraint white_label_platforms_status_check check (status in ('active', 'paused', 'suspended', 'archived')));
    create index if not exists white_label_platforms_status_idx on public.white_label_platforms(status, created_at desc);
    create table if not exists public.white_label_platform_memberships (
      id uuid primary key default gen_random_uuid(),
      white_label_platform_id uuid not null references public.white_label_platforms(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade, membership_role text not null default 'admin', status text not null default 'active',
      invited_by uuid null references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb,
      constraint white_label_platform_memberships_role_check check (membership_role in ('owner', 'admin', 'viewer')),
      constraint white_label_platform_memberships_status_check check (status in ('active', 'invited', 'disabled', 'removed')),
      constraint white_label_platform_memberships_user_key unique (white_label_platform_id, user_id));
    create index if not exists white_label_platform_memberships_user_idx on public.white_label_platform_memberships(user_id, status);
    create index if not exists white_label_platform_memberships_platform_idx on public.white_label_platform_memberships(white_label_platform_id, status);
    alter table public.white_label_platforms enable row level security;
    alter table public.white_label_platform_memberships enable row level security;
    NOTIFY pgrst, 'reload schema';`)
}

/**
 * A white-label platform with one member, as Gridex staff register a white-label partner (platform row and its
 * member; the partner user is a Supabase Auth user created through GoTrue so it can sign in). The member also
 * gets the white_label_platform_admin role with its whitelabel.read/write permissions (production role catalog,
 * 20260521_actor_testing_go_live_module.sql) and an active membership in `homeCompanyId` (the admin workspace
 * requires one operational company). The role is bound to that company: production refuses a global company-scoped role
 * (gridex_assert_role_scope_is_consistent, company_role_requires_company; FINDINGS T33).
 */
export async function createWhiteLabelPartner(name: string, homeCompanyId: string) {
  const platformId = randomUUID(), userId = randomUUID()
  const email = `e2e-wl-${userId.slice(0, 8)}@example.invalid`, password = `WhiteLabel-${randomUUID()}`
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Error('statistics_supabase_env_required')
  const created = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: userId, email, password, email_confirm: true }) })
  if (!created.ok) throw Error(`white_label_user_failed:${created.status}:${await created.text()}`)
  sql(`INSERT INTO public.white_label_platforms(id,name,slug,status) VALUES(${literal(platformId)},${literal(name)},${literal(`e2e-wl-${platformId.slice(0, 8)}`)},'active');
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(userId)},${literal(email)},'E2E White-label','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.white_label_platform_memberships(white_label_platform_id,user_id,membership_role,status) VALUES(${literal(platformId)},${literal(userId)},'admin','active');
    INSERT INTO public.roles(key,name,scope,is_system_role,is_active) SELECT 'white_label_platform_admin','White-label platform admin','company',true,true
      WHERE NOT EXISTS(SELECT FROM public.roles WHERE key='white_label_platform_admin');
    INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r JOIN public.permissions p ON p.key IN ('whitelabel.read','whitelabel.write','reports.read')
      WHERE r.key='white_label_platform_admin' AND NOT EXISTS(SELECT FROM public.role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
      VALUES(${literal(homeCompanyId)},${literal(userId)},'viewer','active',now(),'{}','viewer',true,now(),'viewer');
    INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active) SELECT ${literal(userId)},id,'white_label_platform_admin',${literal(homeCompanyId)},'active',true FROM public.roles WHERE key='white_label_platform_admin';`)
  return { platformId, userId, email, password }
}

/** A minimal workspace company for a white-label partner user (no customers; never part of any platform). */
export function createPartnerHomeCompany(name: string) {
  const id = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status,slug) VALUES(${literal(id)},${literal(name)},'active',${literal(`e2e-wl-home-${id.slice(0, 8)}`)})`)
  return id
}

/** What the tenant's monthly snapshot (Analys page) holds for one month. */
export function snapshotMonth(companyId: string, month: string) {
  return sql<Record<string, number | null> | null>(`SELECT to_jsonb(x) FROM (SELECT total_customers,new_customers,active_customers,ended_customers,active_sites,total_sites,
    active_metering_points,total_metering_points,metering_values_received,metering_values_missing FROM public.company_monthly_metrics
    WHERE company_id=${literal(companyId)} AND month=${literal(`${month}-01`)}) x`)
}
