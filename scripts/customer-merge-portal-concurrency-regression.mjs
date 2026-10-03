import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const databaseUrl = process.argv[2]
const parsed = new URL(databaseUrl)
assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol))
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'This synthetic regression requires a local replay database')
const fixture = { tenant: randomUUID(), actor: randomUUID(), primary: randomUUID(), source: randomUUID(), user: randomUUID(), late: randomUUID(), update_source: randomUUID(), update_user: randomUUID(), profile_source: randomUUID(), api_client: randomUUID() }
const suffix = randomUUID()
const holderName = `merge-holder-${suffix}`
const followerName = `merge-follower-${suffix}`

function sql(statement, applicationName = `merge-check-${suffix}`) {
  return new Promise((resolve, reject) => {
    const proc = spawn('psql', [databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', ...Object.entries(fixture).flatMap(([key, value]) => ['-v', `${key}=${value}`])], {
      env: { ...process.env, PGAPPNAME: applicationName }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let error = ''
    proc.stdout.on('data', (chunk) => { output += chunk })
    proc.stderr.on('data', (chunk) => { error += chunk })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, output, error }))
    proc.stdin.end(statement)
  })
}

async function requireSql(statement) {
  const result = await sql(statement)
  assert.equal(result.code, 0, result.error)
  return result.output.trim()
}

async function observe(applicationName, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const output = await requireSql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${applicationName}' AND ${predicate};`)
    if (output === '1') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`Expected local session state was not observed: ${applicationName}`)
}

let holder
let follower
try {
  await requireSql(`
    INSERT INTO auth.users(id,email) VALUES(:'actor','merge-concurrency@example.invalid');
    INSERT INTO public.companies(id,name,status) VALUES(:'tenant','Synthetic merge concurrency','active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
    VALUES(:'primary',:'tenant','CON-1','Primary','private','active'),(:'source',:'tenant','CON-2','Source','private','active');
    INSERT INTO public.customer_portal_identities(company_id,customer_id,provider,external_customer_id,auth_user_id,customer_portal_user_id,status,match_strength)
    VALUES(:'tenant',:'source','gridex_website','concurrent-existing',:'user',:'user','active','strong');
  `)
  holder = sql(`
    BEGIN;
    SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
    SELECT set_config('request.jwt.claim.role','service_role',true);
    SELECT public.gridex_merge_customers_v1(:'tenant',:'primary',ARRAY[:'source'::uuid],:'actor','Synthetic concurrency proof');
    SELECT pg_sleep(2);
    COMMIT;
  `, holderName)
  await observe(holderName, "wait_event='PgSleep'")
  // This request already selected the old source before the merge. Its insert
  // must wait for the merge's customer lock, then recheck the committed marker.
  follower = sql(`
    INSERT INTO public.customer_portal_identities(company_id,customer_id,provider,external_customer_id,auth_user_id,customer_portal_user_id,status,match_strength)
    VALUES(:'tenant',:'source','gridex_website','concurrent-late',:'late',:'late','active','strong');
  `, followerName)
  await observe(followerName, "wait_event_type='Lock'")
  const [merged, blocked] = await Promise.all([holder, follower])
  assert.equal(merged.code, 0, merged.error)
  assert.notEqual(blocked.code, 0, 'Stale source identity was created after concurrent merge')
  assert.match(blocked.error, /customer_merged_write_conflict/)
  assert.equal(await requireSql(`SELECT count(*) FROM public.customer_portal_identities WHERE company_id=:'tenant' AND external_customer_id='concurrent-late';`), '0')
  assert.equal(await requireSql(`SELECT count(*) FROM public.customer_portal_identities WHERE company_id=:'tenant' AND customer_id=:'primary' AND external_customer_id='concurrent-existing';`), '1')

  // UPDATE obtains the existing child tuple before its trigger runs. NOWAIT
  // prevents the inverse lock order from deadlocking the merging transaction.
  await requireSql(`
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status) VALUES(:'update_source',:'tenant','CON-3','Update source','private','active');
    INSERT INTO public.customer_portal_identities(company_id,customer_id,provider,external_customer_id,auth_user_id,customer_portal_user_id,status,match_strength)
    VALUES(:'tenant',:'update_source','gridex_website','concurrent-update',:'update_user',:'update_user','active','strong');
  `)
  holder = sql(`
    BEGIN;
    SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
    SELECT set_config('request.jwt.claim.role','service_role',true);
    SELECT id FROM public.customers WHERE id=:'update_source' FOR UPDATE;
    SELECT pg_sleep(1);
    SELECT public.gridex_merge_customers_v1(:'tenant',:'primary',ARRAY[:'update_source'::uuid],:'actor','Synthetic UPDATE concurrency proof');
    COMMIT;
  `, holderName)
  await observe(holderName, "wait_event='PgSleep'")
  follower = sql(`UPDATE public.customer_portal_identities SET customer_id=customer_id WHERE company_id=:'tenant' AND external_customer_id='concurrent-update';`, followerName)
  const updated = await follower
  assert.notEqual(updated.code, 0, 'Existing binding UPDATE waited in the inverse merge lock order')
  assert.match(updated.error, /customer_merged_write_conflict/)
  assert.equal((await holder).code, 0, 'The merge must complete without a deadlock')
  assert.equal(await requireSql(`SELECT count(*) FROM public.customer_portal_identities WHERE company_id=:'tenant' AND customer_id=:'primary' AND external_customer_id='concurrent-update';`), '1')

  await requireSql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status) VALUES(:'profile_source',:'tenant','CON-4','Profile source','private','active');`)
  holder = sql(`
    BEGIN;
    SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
    SELECT set_config('request.jwt.claim.role','service_role',true);
    SELECT public.gridex_merge_customers_v1(:'tenant',:'primary',ARRAY[:'profile_source'::uuid],:'actor','Synthetic profile concurrency proof');
    SELECT pg_sleep(1);
    COMMIT;
  `, holderName)
  await observe(holderName, "wait_event='PgSleep'")
  follower = sql(`SELECT public.gridex_customer_contact_change_v1(:'tenant',:'profile_source','customer_portal',NULL,:'api_client',NULL,'customer_api',NULL,'{"phone":"0100000000"}','{}',NULL);`, followerName)
  await observe(followerName, "wait_event_type='Lock'")
  const [profileMerge, profileWrite] = await Promise.all([holder, follower])
  assert.equal(profileMerge.code, 0, profileMerge.error)
  assert.notEqual(profileWrite.code, 0, 'Stale profile changed a merged source')
  assert.match(profileWrite.error, /customer_merged_write_conflict/)
  assert.equal(await requireSql(`SELECT count(*) FROM public.customers WHERE id=:'profile_source' AND phone IS NOT NULL;`), '0')
  assert.equal(await requireSql(`SELECT count(*) FROM public.domain_events WHERE company_id=:'tenant' AND subject_customer_id=:'profile_source';`), '0')
} finally {
  await Promise.allSettled([holder, follower].filter(Boolean))
  // Company onboarding publishes immutable legal texts. Retain their synthetic
  // tenant until this local replay database is discarded; deleting the company
  // would cascade into those protected versions and correctly fail. Clean only
  // the mutable concurrency fixture, without bypassing any legal-text guard.
  await requireSql(`
    DELETE FROM public.customer_portal_identities WHERE company_id=:'tenant';
    DELETE FROM public.customer_merge_events WHERE company_id=:'tenant';
    DELETE FROM public.audit_logs WHERE company_id=:'tenant';
    DELETE FROM public.customers WHERE company_id=:'tenant';
    DELETE FROM auth.users WHERE id=:'actor';
  `)
}
console.log('Customer merge portal concurrency regression passed: INSERT/profile wait and recheck; UPDATE fails without deadlock; mutable fixtures cleaned.')
