import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql(command: string): string {
  return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 15_000,
  }).trim()
}
function session(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part })
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? -1))
  })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 75))
  }
}

it('serializes two real sessions against the same customer revision', async () => {
  if (process.env.GRIDEX_NATIVE_STATUS === undefined || process.env.CI !== 'true') {
    throw new Error('disposable_ci_replay_only')
  }
  const company = randomUUID(), actor = randomUUID(), customer = randomUUID(), contact = randomUUID()
  const email = `${actor}@example.invalid`
  sql(`
    INSERT INTO public.companies(id,name,status) VALUES(${quote(company)},'Synthetic concurrency tenant','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(actor)},'authenticated','authenticated',${quote(email)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(actor)},${quote(email)},'Synthetic actor','active');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(company)},${quote(actor)},'company_admin','active',now(),'company_admin',true,now(),'company_admin');
    INSERT INTO public.permissions(key,name) VALUES('masterdata.write','Synthetic masterdata write') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${quote(actor)},${quote(company)},id,key FROM public.permissions WHERE key='masterdata.write';
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone)
      VALUES(${quote(customer)},${quote(company)},${quote(customer)},'Synthetic contact customer','private','Synthetic','Customer','concurrent@example.invalid','+4600000000');
    INSERT INTO public.customer_contacts(id,company_id,customer_id,type,is_primary,name,email,phone)
      VALUES(${quote(contact)},${quote(company)},${quote(customer)},'primary',true,'Synthetic Contact','concurrent@example.invalid','+4600000000');
  `)
  const base = `'companyId',${quote(company)},'customerId',${quote(customer)},'contactId',${quote(contact)},'actorUserId',${quote(actor)},'mode','ops','reason','Synthetic concurrent contact change','expectedRevision',0`
  const command = (key: string, phone: string) =>
    `SELECT public.gridex_change_customer_contact_v1(jsonb_build_object(${base},'idempotencyKey',${quote(key)},'changes',jsonb_build_object('phone',${quote(phone)})));`
  const first = session('p2_contact_a'), second = session('p2_contact_b')
  try {
    first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SELECT id FROM public.customers WHERE id=${quote(customer)} FOR UPDATE;\n\\echo P2_LOCKED\n`)
    await until(() => first.output().stdout.includes('P2_LOCKED'), 'first_session_did_not_lock_customer')
    second.child.stdin.end(`SET ROLE service_role; ${command('p2-concurrent-second', '+46222222222')}\n`)
    await until(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='p2_contact_b' AND wait_event_type='Lock');`) === 't', 'second_session_did_not_wait_on_customer_lock')
    first.child.stdin.end(`${command('p2-concurrent-first', '+46111111111')} COMMIT;\n`)
    expect(await first.exited).toBe(0)
    expect(await second.exited).not.toBe(0)
    expect(first.output().stdout).toContain('"revision": 1')
    expect(second.output().stderr).toContain('contact_revision_conflict')
    const result = JSON.parse(sql(`SELECT jsonb_build_object(
      'revision',(SELECT contact_revision FROM public.customers WHERE id=${quote(customer)}),
      'phone',(SELECT phone FROM public.customer_contacts WHERE id=${quote(contact)}),
      'commands',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${quote(company)} AND command_type='customer.contact.change.v1'),
      'outbox',(SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=${quote(company)} AND topic='customer.contact.changed')
    );`))
    expect(result).toEqual({ revision: 1, phone: '+46111111111', commands: 1, outbox: 1 })
  } finally {
    for (const item of [first, second]) {
      if (item.child.exitCode === null) item.child.kill('SIGTERM')
    }
  }
})
