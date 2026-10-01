import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

export const REGISTRY_API = 'http://127.0.0.1:54321'
const DATABASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const REGISTRY_SIGNATURE = 'public.gridex_customer_registry_page_v1(uuid,text,text,text,text,text,boolean,integer,integer)'
// prosrc bytes from the frozen 20261001114832 owner, not a second SQL implementation.
export const REGISTRY_BODY_SHA256 = 'c9349d0217763ee8e7dcbcadca54e9f9f07f8fca22c93a12a51d2a3e3cac9cfd'

type Environment = Record<string, string | undefined>
export type RegistryNativeEnvironment = {
  statusPath: string; runnerTemp: string; anonKey: string; serviceKey: string
}
export function registryNativeEnvironment(env: Environment): RegistryNativeEnvironment {
  if (env.CI !== 'true' || !env.RUNNER_TEMP || !env.GRIDEX_NATIVE_STATUS) {
    throw new Error('u07_native_disposable_ci_required')
  }
  const temp = realpathSync(env.RUNNER_TEMP), statusPath = resolve(env.GRIDEX_NATIVE_STATUS)
  const statusFile = lstatSync(statusPath), parent = realpathSync(dirname(statusPath))
  if (!statusFile.isFile() || statusFile.isSymbolicLink() || (statusFile.mode & 0o077) !== 0
    || !statusPath.startsWith(temp + sep) || !realpathSync(statusPath).startsWith(temp + sep)
    || parent === temp || !parent.startsWith(temp + sep) || (lstatSync(parent).mode & 0o077) !== 0) {
    throw new Error('u07_native_private_status_required')
  }
  let value: unknown
  try { value = JSON.parse(readFileSync(statusPath, 'utf8')) } catch { throw new Error('u07_native_status_invalid') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('u07_native_status_invalid')
  const status = value as Record<string, unknown>
  if (status.API_URL !== REGISTRY_API || typeof status.ANON_KEY !== 'string' || !status.ANON_KEY.trim()
    || typeof status.SERVICE_ROLE_KEY !== 'string' || !status.SERVICE_ROLE_KEY.trim()
    || status.ANON_KEY === status.SERVICE_ROLE_KEY
    || (status.DB_URL !== undefined && status.DB_URL !== DATABASE)) {
    throw new Error('u07_native_owned_stack_required')
  }
  return { statusPath, runnerTemp: temp, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY }
}
export function registrySql<T>(command: string): T {
  registryNativeEnvironment(process.env)
  try {
    const text = execFileSync('psql', [DATABASE, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
      input: command, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return JSON.parse(text) as T
  } catch (error) {
    const diagnostic = error as { stderr?: unknown }
    const code = String(diagnostic.stderr ?? '').match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1]
    throw new Error('u07_native_database_boundary_failed' + (code ? `:${code}` : ''))
  }
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
export type RegistryReadFixture = {
  company: string; quietCompany: string; malformedCompany: string; token: string
  oldest: string; newest: string; quietCustomer: string; malformedCustomer: string
  oldSite: string; newestSite: string; quietSite: string; oldPoint: string; quietPoint: string
  oldContract: string; quietContract: string; oldPoa: string; quietPoa: string
  folder: string
}
export function createRegistryReadFixture(): RegistryReadFixture {
  const environment = registryNativeEnvironment(process.env)
  const prefix = randomUUID().slice(0, 24), id = (n: number) => prefix + n.toString(16).padStart(12, '0')
  const folder = mkdtempSync(join(environment.runnerTemp, 'u07-registry-read-'))
  chmodSync(folder, 0o700)
  const f: RegistryReadFixture = {
    company: randomUUID(), quietCompany: randomUUID(), malformedCompany: randomUUID(),
    token: `U07${randomUUID().replaceAll('-', '')}`, oldest: id(1), newest: id(1001),
    quietCustomer: id(2001), malformedCustomer: id(2002),
    oldSite: id(12001), newestSite: id(10001), quietSite: id(12003),
    oldPoint: id(32001), quietPoint: id(32002), oldContract: id(42001), quietContract: id(42002),
    oldPoa: id(52001), quietPoa: id(52002), folder,
  }
  const generated = (offset: number) => `(${quote(prefix)} || lpad(to_hex(${offset}+n),12,'0'))::uuid`
  // These are stored read fixtures. No signed status, legal acceptance,
  // signature, source receipt, readiness override or production guard bypass.
  registrySql(`BEGIN;
    INSERT INTO public.companies(id,name,status,operating_environment) VALUES
      (${quote(f.company)},'Synthetic U07 read company','active','test'),
      (${quote(f.quietCompany)},'Synthetic U07 quiet company','active','test'),
      (${quote(f.malformedCompany)},'Synthetic U07 alias company','active','test');
    INSERT INTO public.customers(id,company_id,customer_number,full_name,customer_type,status,source,created_at)
      SELECT ${generated(0)},${quote(f.company)},${quote(f.token)}||'-'||n,
        CASE WHEN n=1 THEN 'literal_%(,).''value' ELSE 'Synthetic corpus '||n END,
        CASE WHEN n IN(1,1001) THEN 'business' ELSE 'private' END,
        CASE WHEN n=1 THEN 'blocked' ELSE 'active' END,'u07_native_read_fixture',
        '2026-09-01T00:00:00.123456Z'::timestamptz+n*interval '1 second'
      FROM generate_series(1,1001) n;
    INSERT INTO public.customers(id,company_id,customer_number,full_name,status,source) VALUES
      (${quote(f.quietCustomer)},${quote(f.quietCompany)},${quote(f.token + '-quiet')},'Synthetic quiet corpus','active','u07_native_read_fixture'),
      (${quote(f.malformedCustomer)},${quote(f.malformedCompany)},${quote('ALIAS' + prefix.replaceAll('-', ''))},'Synthetic malformed alias graph','active','u07_native_read_fixture');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status)
      SELECT ${generated(10000)},${quote(f.company)},${quote(f.newest)},'Synthetic relation '||n,'active'
      FROM generate_series(1,1001) n;
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status) VALUES
      (${quote(f.oldSite)},${quote(f.company)},${quote(f.oldest)},'Synthetic oldest site A','active'),
      (${quote(id(12002))},${quote(f.company)},${quote(f.oldest)},'Synthetic oldest site B','active'),
      (${quote(f.quietSite)},${quote(f.quietCompany)},${quote(f.quietCustomer)},'Synthetic quiet site','active'),
      (${quote(id(12004))},${quote(f.malformedCompany)},${quote(f.malformedCustomer)},'Synthetic alias site A','active'),
      (${quote(id(12005))},${quote(f.malformedCompany)},${quote(f.malformedCustomer)},'Synthetic alias site B','active');
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,status)
      SELECT ${generated(30000)},${quote(f.company)},${quote(f.newest)},${quote(f.newestSite)},${quote(f.newestSite)},'active'
      FROM generate_series(1,1001) n;
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,status) VALUES
      (${quote(f.oldPoint)},${quote(f.company)},NULL,${quote(f.oldSite)},${quote(f.oldSite)},'active'),
      (${quote(f.quietPoint)},${quote(f.quietCompany)},${quote(f.quietCustomer)},${quote(f.quietSite)},${quote(f.quietSite)},'active'),
      (${quote(id(32003))},${quote(f.malformedCompany)},NULL,${quote(id(12005))},${quote(id(12004))},'active');
    INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status,created_at)
      SELECT ${generated(40000)},${quote(f.company)},${quote(f.newest)},${quote(f.newestSite)},${quote(f.newestSite)},${quote(id(30001))},'draft',
        '2026-09-02T00:00:00.123456Z'::timestamptz FROM generate_series(1,1001) n;
    INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status) VALUES
      (${quote(f.oldContract)},${quote(f.company)},${quote(f.oldest)},${quote(f.oldSite)},${quote(f.oldSite)},${quote(f.oldPoint)},'draft'),
      (${quote(f.quietContract)},${quote(f.quietCompany)},${quote(f.quietCustomer)},${quote(f.quietSite)},${quote(f.quietSite)},${quote(f.quietPoint)},'draft');
    INSERT INTO public.powers_of_attorney(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,status)
      SELECT ${generated(50000)},${quote(f.company)},${quote(f.newest)},${quote(f.newestSite)},${quote(f.newestSite)},${quote(id(30001))},
        ${quote(id(40001))},${quote(id(40001))},'draft' FROM generate_series(1,1001) n;
    INSERT INTO public.powers_of_attorney(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,status) VALUES
      (${quote(f.oldPoa)},${quote(f.company)},${quote(f.oldest)},${quote(f.oldSite)},${quote(f.oldSite)},${quote(f.oldPoint)},${quote(f.oldContract)},${quote(f.oldContract)},'draft'),
      (${quote(f.quietPoa)},${quote(f.quietCompany)},${quote(f.quietCustomer)},${quote(f.quietSite)},${quote(f.quietSite)},${quote(f.quietPoint)},${quote(f.quietContract)},${quote(f.quietContract)},'draft');
    COMMIT;
    SELECT to_jsonb(true);`)
  writeFileSync(join(folder, 'fixture.json'), JSON.stringify(f), { mode: 0o600, flag: 'wx' })
  return f
}

export function registryInstalledOwner() {
  return registrySql<{ stable: string; invoker: boolean; config: string[]; service: boolean; anon: boolean; authenticated: boolean; bodySha256: string }>(`
    SELECT jsonb_build_object('stable',p.provolatile,'invoker',NOT p.prosecdef,'config',p.proconfig,
      'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
    FROM pg_proc p WHERE p.oid=${quote(REGISTRY_SIGNATURE)}::regprocedure;`)
}
export function registryPersistentSnapshot(): { data: Record<string, string>; catalog: string } {
  // Full values are hashed inside PostgreSQL. No decimal/bigint/auth body is
  // converted through JavaScript or printed. Auth refresh/session writes are
  // outside this business-read claim; no Auth call happens between snapshots.
  const tables = registrySql<Array<{ schema: string; name: string }>>(`SELECT coalesce(jsonb_agg(
    jsonb_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN('public','private','gridex_correction_process') AND c.relkind IN('r','p');`)
  if (!tables.length) throw new Error('u07_native_business_catalog_missing')
  const hashes = tables.map(t => `SELECT ${quote(t.schema + '.' + t.name)} AS name,
    (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex')
      FROM ${identifier(t.schema)}.${identifier(t.name)} r) AS hash`).join(' UNION ALL ')
  return registrySql(`BEGIN READ ONLY;
    SELECT jsonb_build_object('data',(SELECT jsonb_object_agg(name,hash ORDER BY name) FROM (${hashes}) h),
      'catalog',encode(sha256(convert_to(jsonb_build_object(
        'relations',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','gridex_correction_process')),
        'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.oid,p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,p.prosrc) ORDER BY p.oid)
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','gridex_correction_process')),
        'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
          WHERE n.nspname IN('public','private','gridex_correction_process')),
        'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN('public','private','gridex_correction_process')),
        'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN('public','private','gridex_correction_process'))
      )::text,'UTF8')),'hex'));
    COMMIT;`)
}
