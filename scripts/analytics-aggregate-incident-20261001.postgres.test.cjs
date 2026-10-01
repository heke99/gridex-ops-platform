const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')

const root = resolve(__dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260531160000_analytics_forecasting_module.sql'), 'utf8')
const definition = name => {
  const found = migration.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'))
  assert.ok(found, `actual ${name} DDL required`)
  return found[0]
}
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002'
async function fixture() {
  const db = new PGlite()
  await db.exec(`CREATE TABLE public.companies(id uuid primary key); INSERT INTO companies VALUES('${A}'),('${B}');
    ${definition('dashboard_alerts')} ${definition('data_quality_issues')}`)
  // Only the PostgREST transport is adapted. The actual exported functions,
  // actual table definitions and PostgreSQL uniqueness/upsert execute here.
  const service = { from: table => {
    assert.ok(['dashboard_alerts', 'data_quality_issues'].includes(table))
    const filters = []
    const query = {
      select: () => query,
      eq: (key, value) => { assert.ok(['company_id', 'status'].includes(key)); filters.push([key, value]); return query },
      then: async done => done({ error: null, data: (await db.query(`SELECT * FROM public.${table} WHERE ${filters.map(([key], i) => `${key}=$${i + 1}`).join(' AND ')}`, filters.map(([, value]) => value))).rows }),
      upsert: async (payload, options) => {
        assert.equal(options.onConflict, 'company_id,alert_type,entity_type,entity_id,status')
        const fields = Object.keys(payload)
        assert.ok(fields.every(key => ['company_id', 'alert_type', 'severity', 'title', 'message', 'entity_type', 'entity_id', 'status', 'resolved_at'].includes(key)))
        await db.query(`INSERT INTO public.dashboard_alerts(${fields.join(',')}) VALUES(${fields.map((_, i) => `$${i + 1}`).join(',')})
          ON CONFLICT(${options.onConflict}) DO UPDATE SET title=excluded.title,message=excluded.message,severity=excluded.severity,resolved_at=excluded.resolved_at`, Object.values(payload))
        return { error: null }
      },
    }
    return query
  } }
  const module = { exports: {} }
  runInNewContext(ts.transpileModule(readFileSync(resolve(root, 'lib/analytics/alerts.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, require: name => { assert.equal(name, '@/lib/supabase/service'); return { supabaseService: service } },
  })
  return { db, ...module.exports }
}

test('original exact unique constraint allows two NULL-identity aggregates: root cause witness', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 2; i++) await f.db.query(`INSERT INTO dashboard_alerts(company_id,alert_type,title) VALUES($1,'data_quality','Historical NULL identity')
      ON CONFLICT(company_id,alert_type,entity_type,entity_id,status) DO UPDATE SET title=excluded.title`, [A])
    assert.equal((await f.db.query('SELECT * FROM dashboard_alerts')).rows.length, 2)
  } finally { await f.db.close() }
})

test('actual adapter twice updates one aggregate and preserves explicit entity and quiet tenant', async () => {
  const f = await fixture()
  try {
    await f.createDashboardAlert({ companyId: B, alertType: 'data_quality', title: 'Quiet tenant' })
    await f.createDashboardAlert({ companyId: A, alertType: 'data_quality', title: 'Customer issue', entityType: 'customer', entityId: B })
    const quiet = (await f.db.query('SELECT * FROM dashboard_alerts WHERE company_id=$1', [B])).rows
    for (const title of ['First aggregate', 'Updated aggregate']) await f.createDashboardAlert({ companyId: A, alertType: 'data_quality', title })
    const rows = (await f.db.query('SELECT * FROM dashboard_alerts WHERE company_id=$1 ORDER BY title', [A])).rows
    assert.equal(rows.length, 2)
    assert.equal(rows.filter(row => row.entity_type === 'company_aggregate' && row.entity_id === A).length, 1)
    assert.equal(rows.find(row => row.entity_type === 'company_aggregate').title, 'Updated aggregate')
    assert.equal(rows.find(row => row.entity_type === 'customer').title, 'Customer issue')
    assert.deepEqual((await f.db.query('SELECT * FROM dashboard_alerts WHERE company_id=$1', [B])).rows, quiet)
  } finally { await f.db.close() }
})

test('actual tenant refresh rerun retains one alert and updates counts without quiet-tenant writes', async () => {
  const f = await fixture()
  try {
    await f.db.query(`INSERT INTO data_quality_issues(company_id,entity_type,entity_id,issue_type,severity,message) VALUES
      ($1,'ediel_message',$2,'failed_ediel_message','critical','Synthetic incident')`, [A, B])
    await f.refreshDashboardAlerts(A)
    await f.refreshDashboardAlerts(A)
    assert.equal((await f.db.query('SELECT * FROM dashboard_alerts WHERE company_id=$1', [A])).rows.length, 1)
    await f.db.query(`INSERT INTO data_quality_issues(company_id,entity_type,issue_type,severity,message) VALUES($1,'ediel_message','failed_ediel_message','warning','Second issue')`, [A])
    await f.refreshDashboardAlerts(A)
    const rows = (await f.db.query('SELECT * FROM dashboard_alerts WHERE company_id=$1', [A])).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, '2 Ediel-meddelanden har misslyckats')
    assert.equal(rows[0].severity, 'critical')
    assert.equal((await f.db.query('SELECT * FROM dashboard_alerts WHERE company_id=$1', [B])).rows.length, 0)
  } finally { await f.db.close() }
})
