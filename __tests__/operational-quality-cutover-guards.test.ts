import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const cutover = readFileSync('quality/admin-consistency-2026-10-13/cleanup/dqi-after-verified-deployment-cutover.sql', 'utf8')
const issuesConstraint = 'data_quality_issues_company_id_entity_type_entity_id_issue__key'
const alertsConstraint = 'dashboard_alerts_company_id_alert_type_entity_type_entity_i_key'
type Variant = 'valid' | 'missing' | 'nonunique' | 'reversed' | 'partial' | 'nulls-not-distinct' | 'included' | 'legacy-columns' | 'legacy-check' | 'legacy-deferred' | 'legacy-nulls-not-distinct'

async function fixture(variant: Variant) {
  const pg = new PGlite()
  await pg.exec(`
    create table public.data_quality_issues (
      id integer primary key, company_id uuid not null, entity_type text,
      entity_id uuid, issue_type text, status text, open_key text);
    create table public.dashboard_alerts (
      id integer primary key, company_id uuid not null, alert_type text,
      entity_type text, entity_id uuid, status text, open_key text);
    alter table public.dashboard_alerts add constraint ${alertsConstraint}
      unique(company_id,alert_type,entity_type,entity_id,status);
    create unique index dashboard_alerts_open_key_uidx on public.dashboard_alerts(company_id,open_key);
    create function public.cutover_preserved_v1() returns integer language sql stable security definer
      set search_path=public,pg_temp as $$select 41$$;
    revoke all on function public.cutover_preserved_v1() from public;
    comment on function public.cutover_preserved_v1() is 'preserve owner, ACL, body and comment';
  `)
  const legacy = variant === 'legacy-check' ? "check(status in ('open','resolved'))"
    : variant === 'legacy-columns' ? 'unique(company_id,entity_type,entity_id,issue_type,open_key)'
      : variant === 'legacy-nulls-not-distinct' ? 'unique nulls not distinct(company_id,entity_type,entity_id,issue_type,status)'
      : `unique(company_id,entity_type,entity_id,issue_type,status)${variant === 'legacy-deferred' ? ' deferrable initially deferred' : ''}`
  await pg.exec(`alter table public.data_quality_issues add constraint ${issuesConstraint} ${legacy}`)
  if (variant !== 'missing') {
    const columns = variant === 'reversed' ? 'open_key,company_id' : 'company_id,open_key'
    const suffix = variant === 'partial' ? " where status='open'" : variant === 'included' ? ' include(status)'
      : variant === 'nulls-not-distinct' ? ' nulls not distinct' : ''
    await pg.exec(`create ${variant === 'nonunique' ? '' : 'unique '}index data_quality_issues_open_key_uidx
      on public.data_quality_issues(${columns})${suffix}`)
  }
  await pg.exec(`
    insert into public.data_quality_issues values (1,'00000000-0000-4000-8000-000000000001','site',null,'missing','open','scoped:issue');
    insert into public.dashboard_alerts values (1,'00000000-0000-4000-8000-000000000001','missing','site',null,'open','scoped:alert');
  `)
  return pg
}

async function state(pg: PGlite) {
  return (await pg.query<{ issues: unknown; alerts: unknown; constraints: unknown; preserved_function: unknown }>(`select
    (select jsonb_agg(to_jsonb(t) order by id) from public.data_quality_issues t) issues,
    (select jsonb_agg(to_jsonb(t) order by id) from public.dashboard_alerts t) alerts,
    (select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname)
      from pg_constraint where conrelid in ('public.data_quality_issues'::regclass,'public.dashboard_alerts'::regclass)) constraints,
    (select jsonb_build_array(oid,proowner,proacl::text,pg_get_functiondef(oid),obj_description(oid,'pg_proc'))
      from pg_proc where oid='public.cutover_preserved_v1()'::regprocedure) preserved_function`)).rows[0]
}

it('removes exactly the legacy uniqueness while preserving records, function metadata and open-key inference', async () => {
  const pg = await fixture('valid')
  try {
    await pg.exec(`insert into public.data_quality_issues values
      (2,'00000000-0000-4000-8000-000000000001','site','00000000-0000-4000-8000-000000000002','missing','resolved',null)`)
    const before = await state(pg)
    await pg.exec(cutover)
    const after = await state(pg)
    expect(after.issues).toEqual(before.issues)
    expect(after.alerts).toEqual(before.alerts)
    expect(after.preserved_function).toEqual(before.preserved_function)
    expect(await pg.query('select conname from pg_constraint where conname in ($1,$2)', [issuesConstraint, alertsConstraint]))
      .toMatchObject({ rows: [] })
    await pg.exec(`
      insert into public.data_quality_issues values (1,'00000000-0000-4000-8000-000000000001','site',null,'missing','open','scoped:issue')
        on conflict(company_id,open_key) do update set issue_type=excluded.issue_type;
      insert into public.dashboard_alerts values (1,'00000000-0000-4000-8000-000000000001','missing','site',null,'open','scoped:alert')
        on conflict(company_id,open_key) do update set alert_type=excluded.alert_type;
      insert into public.data_quality_issues values
        (3,'00000000-0000-4000-8000-000000000001','site','00000000-0000-4000-8000-000000000002','missing','resolved',null);
    `)
    const beforeReplay = await state(pg)
    await pg.exec(cutover)
    expect(await state(pg)).toEqual(beforeReplay)
  } finally {
    await pg.close()
  }
}, 30_000)

it.each(['missing', 'nonunique', 'reversed', 'partial', 'nulls-not-distinct', 'included', 'legacy-columns', 'legacy-check', 'legacy-deferred', 'legacy-nulls-not-distinct'] as const)(
  'refuses the %s catalog before dropping a constraint or changing records', async (variant) => {
    const pg = await fixture(variant)
    try {
      const before = await state(pg)
      await expect(pg.exec(cutover)).rejects.toThrow(variant.startsWith('legacy-')
        ? 'quality_cutover_legacy_constraint_unqualified' : 'quality_cutover_open_key_index_unqualified')
      await pg.exec('rollback')
      expect(await state(pg)).toEqual(before)
    } finally {
      await pg.close()
    }
  }, 30_000,
)
