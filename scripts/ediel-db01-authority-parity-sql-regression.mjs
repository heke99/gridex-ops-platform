// DB-01 relation containment over captured SQL and declared host rows. This
// does not publish a legal decision, qualify a registry source, or execute an
// accepted protected original producer. Those positives need native upgrade.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = process.env.EDIEL_PGLITE_MODULE
  ? await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
  : await import('@electric-sql/pglite')
const schemaCommit = '56e58b95518ec4d5eef210ba16ba46228afb40ac'
const schemaSha256 = '8dc63eaab63bae12a267e3e2a45c16c6bdb8d729b26e8e454791b66fcd08f38f'
const repositoryPath = fileURLToPath(new URL('../', import.meta.url))
const forwardPath = new URL('../supabase/migrations/20261006210116_ediel_db01_legacy_address_containment.sql', import.meta.url)
let schema
try {
  schema = execFileSync('git', ['show', `${schemaCommit}:supabase/schema.sql`], {
    cwd: repositoryPath, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch {
  throw new Error(`Historical schema unavailable; fetch commit ${schemaCommit} before running this regression`)
}
assert.equal(createHash('sha256').update(schema).digest('hex'), schemaSha256, 'pinned historical schema SHA256')
const forward = existsSync(forwardPath) ? readFileSync(forwardPath, 'utf8') : null
const archive = 'gridex_ediel_legacy_archive'
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const q = value => `'${String(value).replaceAll("'", "''")}'`
const sha = value => createHash('sha256').update(value).digest('hex')
const db = new PGlite()
const creators = ['ediel_create_bilateral_prodat_original_v1', 'ediel_create_national_supply_rescission_original_v1']
const fkNames = ['ediel_messages_party_address_id_fkey', 'ediel_route_profiles_party_address_id_fkey',
  'ediel_party_addresses_party_id_fkey', 'ediel_party_addresses_receiver_certificate_id_fkey']
const roles = ['anon', 'authenticated', 'service_role', 'db01_fixture_api_member']
const results = []
let addressOid

function table(name) {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`)
  const end = schema.indexOf('\n);', start)
  assert.ok(start >= 0 && end > start, `captured table ${name}`)
  return schema.slice(start, end + 3)
}
function fn(name) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  const end = schema.indexOf('\n--\n', start)
  assert.ok(start >= 0 && end > start, `captured function ${name}`)
  return schema.slice(start, end).trim()
}
async function test(name, run) {
  try { await run(); results.push({ name, status: 'PASS' }) }
  catch (error) { results.push({ name, status: 'FAIL', reason: String(error.message).slice(0, 230) }) }
}
const rows = async sql => (await db.query(sql)).rows
const one = async sql => (await rows(sql))[0]
async function transaction(run) {
  await db.exec('BEGIN')
  try { return await run() } finally { await db.exec('ROLLBACK') }
}
async function addressName() {
  return (await one(`SELECT format('%I.%I',n.nspname,c.relname) name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=${addressOid}`)).name
}
async function relationRows(name) {
  return rows(`SELECT id,to_jsonb(t) original,
    encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') hash FROM ${name} t ORDER BY id`)
}
async function originals() {
  return { addresses: await relationRows(await addressName()), messages: await relationRows('public.ediel_messages'),
    profiles: await relationRows('public.ediel_route_profiles') }
}
async function relationMetadata() {
  return one(`SELECT oid,relowner,reltype,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=${addressOid}`)
}
async function policies() {
  return rows(`SELECT oid,polname,polcmd,polpermissive,polroles::text,
    pg_get_expr(polqual,polrelid) qualification,pg_get_expr(polwithcheck,polrelid) withcheck
    FROM pg_policy WHERE polrelid=${addressOid} ORDER BY polname`)
}
async function indexes() {
  return rows(`SELECT indexrelid,indexrelid::oid::text id,indisunique,indisprimary,indisvalid,
    indkey::text,replace(pg_get_indexdef(indexrelid),'${archive}.','public.') definition
    FROM pg_index WHERE indrelid=${addressOid} ORDER BY indexrelid`)
}
async function foreignKeys() {
  return rows(`SELECT oid,conname,conrelid,confrelid,conkey::text,confkey::text,
    confupdtype,confdeltype,condeferrable,condeferred,convalidated
    FROM pg_constraint WHERE conname IN(${fkNames.map(q).join(',')}) ORDER BY conname`)
}
async function creatorState(name) {
  return one(`SELECT to_jsonb(p)-'prosrc' metadata,p.prosrc body FROM pg_proc p
    WHERE p.oid=${q(`public.${name}(uuid,uuid,jsonb)`)}::regprocedure`)
}
async function lifecycle() {
  const name = await addressName()
  return transaction(async () => {
    // Exercise unchanged relational actions as fixture owner, never as a
    // fabricated authorized retention class/issuer/reviewer operation.
    await db.exec(`UPDATE ${name} SET status='inactive',metadata=metadata||'{"fixtureUpdate":true}' WHERE id=${q(uid(21))}`)
    const updated = await one(`SELECT status,metadata->>'fixtureUpdate' changed FROM ${name} WHERE id=${q(uid(21))}`)
    await db.exec(`DELETE FROM public.ediel_certificates WHERE id=${q(uid(31))}`)
    const certificateNull = await one(`SELECT receiver_certificate_id IS NULL cleared FROM ${name} WHERE id=${q(uid(21))}`)
    await db.exec(`DELETE FROM public.ediel_parties WHERE id=${q(uid(11))}`)
    return { updated, certificateNull, remaining: await rows(`SELECT id FROM ${name} ORDER BY id`),
      messages: await rows('SELECT id,party_address_id FROM public.ediel_messages ORDER BY id'),
      profiles: await rows('SELECT id,party_address_id FROM public.ediel_route_profiles ORDER BY id') }
  })
}

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE ROLE db01_fixture_api_member INHERIT; GRANT authenticated,service_role TO db01_fixture_api_member;
    CREATE SCHEMA auth;
    -- JWT identity is a declared fixture boundary. The admin predicate below
    -- is captured unchanged; no source/retention/approval capability is minted.
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
    CREATE TABLE public.user_profiles(id uuid,user_status text);
    CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
    CREATE TABLE public.roles(id uuid,is_active boolean,key text,name text);
    CREATE TABLE public.user_roles(user_id uuid,role_id uuid,company_id uuid,is_active boolean,status text,role text);
    CREATE TABLE public.ediel_certificates(id uuid PRIMARY KEY);
    CREATE TABLE public.ediel_message_intents(id uuid PRIMARY KEY);`)
  await db.exec(fn('gridex_normalize_platform_role'))
  await db.exec(fn('gridex_user_is_platform_admin'))
  for (const name of ['ediel_parties', 'ediel_party_addresses', 'ediel_messages', 'ediel_route_profiles']) {
    await db.exec(table(name))
    const primary = schema.match(new RegExp(`ALTER TABLE ONLY public\\.${name}\\s+ADD CONSTRAINT ${name}_pkey PRIMARY KEY \\(id\\);`))
    assert.ok(primary, `captured primary key ${name}`)
    await db.exec(primary[0])
  }
  const constraintBlocks = schema.match(/ALTER TABLE ONLY public\.[a-z_]+\s+ADD CONSTRAINT [^;]+;/g) ?? []
  for (const name of fkNames) {
    const block = constraintBlocks.find(sql => sql.includes(`ADD CONSTRAINT ${name} `))
    assert.ok(block, `captured foreign key ${name}`)
    await db.exec(block)
  }
  for (const sql of schema.match(/^CREATE (?:UNIQUE )?INDEX [^\n]* ON public\.ediel_party_addresses [^\n]*;$/gm) ?? []) await db.exec(sql)
  const capturedPolicies = schema.match(/^CREATE POLICY [^\n]* ON public\.ediel_party_addresses [^\n]*;$/gm) ?? []
  assert.equal(capturedPolicies.length, 4)
  await db.exec('ALTER TABLE public.ediel_party_addresses ENABLE ROW LEVEL SECURITY')
  for (const sql of capturedPolicies) await db.exec(sql)
  for (const sql of schema.match(/^GRANT [^\n]* ON TABLE public\.ediel_party_addresses [^\n]*;$/gm) ?? []) await db.exec(sql)
  const apiGrants = schema.match(/^GRANT (?:USAGE ON SCHEMA public|ALL ON TABLE public\.(?:ediel_messages|ediel_route_profiles)) TO (?:authenticated|service_role);$/gm) ?? []
  assert.equal(apiGrants.length, 6, 'captured public schema and operational table grants')
  for (const sql of apiGrants) await db.exec(sql)
  for (const name of creators) {
    await db.exec(fn(name))
    const grants = schema.split('\n').filter(line => /^(GRANT|REVOKE) /.test(line) && line.includes(`FUNCTION public.${name}(`))
    for (const sql of grants) await db.exec(sql)
  }
  await db.exec(`INSERT INTO auth.users VALUES('${uid(41)}',NULL,NULL,'2026-01-01');
    INSERT INTO user_profiles VALUES('${uid(41)}','active');INSERT INTO admin_users VALUES('${uid(41)}',true,'platform_admin');
    SELECT set_config('request.jwt.claim.sub','${uid(41)}',false);
    INSERT INTO ediel_parties(id,name,ediel_id) VALUES
      ('${uid(11)}','Historical fixture party one','11111'),('${uid(12)}','Historical fixture party two','22222');`)
  await db.exec(`INSERT INTO ediel_certificates VALUES('${uid(31)}'),('${uid(32)}');
    INSERT INTO ediel_party_addresses(id,party_id,ediel_id,message_family,environment,smtp_address,receiver_certificate_id,metadata,created_at,updated_at)
    VALUES('${uid(21)}','${uid(11)}','11111','PRODAT','test','historical-one@example.invalid','${uid(31)}','{"custody":"fixture-one","nested":{"value":1}}','2026-01-01','2026-01-02'),
      ('${uid(22)}','${uid(12)}','22222','UTILTS','production','historical-two@example.invalid','${uid(32)}','{"custody":"fixture-two","nested":{"value":2}}','2026-02-01','2026-02-02');
    INSERT INTO ediel_messages(id,direction,message_family,raw_payload,party_address_id) VALUES
      ('${uid(51)}','inbound','PRODAT','historical fixture original one','${uid(21)}'),
      ('${uid(52)}','outbound','UTILTS','historical fixture original two','${uid(22)}');
    INSERT INTO ediel_route_profiles(id,party_address_id,metadata) VALUES
      ('${uid(61)}','${uid(21)}','{"fixtureRoute":1}'),('${uid(62)}','${uid(22)}','{"fixtureRoute":2}');`)
  addressOid = (await one("SELECT 'public.ediel_party_addresses'::regclass::oid oid")).oid
  const baseline = { originals: await originals(), relation: await relationMetadata(), policies: await policies(),
    indexes: await indexes(), foreignKeys: await foreignKeys(), lifecycle: await lifecycle(), creators: {} }
  for (const name of creators) baseline.creators[name] = await creatorState(name)
  assert.equal(baseline.originals.addresses.length, 2)
  assert.equal(baseline.foreignKeys.length, 4)

  if (forward) {
    await test('target-name conflict rolls back the entire actual forward', async () => {
      await db.exec(`BEGIN;CREATE SCHEMA ${archive};CREATE TABLE ${archive}.ediel_party_addresses(id uuid);`)
      let error
      try { await db.exec(forward) } catch (caught) { error = caught } finally { await db.exec('ROLLBACK') }
      assert.ok(error, 'conflicting archive relation must refuse migration')
      assert.deepEqual(await originals(), baseline.originals)
      assert.deepEqual(await relationMetadata(), baseline.relation)
      for (const name of creators) assert.deepEqual(await creatorState(name), baseline.creators[name])
      assert.equal((await one(`SELECT to_regnamespace('${archive}') IS NULL absent`)).absent, true)
    })
    await db.exec(forward)
  }

  await test('public legacy address API relation is retired', async () => {
    assert.equal((await one("SELECT to_regclass('public.ediel_party_addresses') IS NULL retired")).retired, true)
  })
  await test('archive is the same original relation OID', async () => {
    assert.equal((await one(`SELECT to_regclass('${archive}.ediel_party_addresses')::oid oid`)).oid, addressOid)
  })
  await test('every historical address/message/profile row and SHA256 is unchanged', async () => assert.deepEqual(await originals(), baseline.originals))
  await test('original table owner/composite type/RLS flags are unchanged', async () => assert.deepEqual(await relationMetadata(), baseline.relation))
  await test('original four policies retain identities and expressions', async () => assert.deepEqual(await policies(), baseline.policies))
  await test('original indexes retain identities, uniqueness and definitions', async () => assert.deepEqual(await indexes(), baseline.indexes))
  await test('all four FKs retain identities, targets, validation and lifecycle actions', async () => assert.deepEqual(await foreignKeys(), baseline.foreignKeys))
  await test('historical reference columns and read types remain', async () => {
    const types = await rows("SELECT attrelid,attname,atttypid FROM pg_attribute WHERE attrelid IN('public.ediel_messages'::regclass,'public.ediel_route_profiles'::regclass) AND attname='party_address_id' AND NOT attisdropped ORDER BY attrelid")
    assert.equal(types.length, 2)
    assert.ok(types.every(row => row.atttypid === 2950))
  })
  for (const role of roles) {
    await test(`archive table effective ACL is closed to ${role}`, async () => {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal((await one(`SELECT has_table_privilege(${q(role)},${addressOid},${q(privilege)}) allowed`)).allowed, false)
      }
    })
    await test(`SET ROLE ${role} cannot read the original through an API schema`, async () => {
      const name = await addressName()
      let failure
      await transaction(async () => {
        await db.exec(`SET LOCAL ROLE ${role}`)
        try { await db.query(`SELECT id FROM ${name}`) } catch (error) { failure = error }
      })
      assert.equal(failure?.code, '42501', 'actual role query must be denied')
    })
  }
  await test('private archive schema grants no API usage, including inherited roles', async () => {
    assert.equal((await one(`SELECT to_regnamespace('${archive}') IS NOT NULL present`)).present, true)
    for (const role of roles) assert.equal((await one(`SELECT has_schema_privilege(${q(role)},${q(archive)},'USAGE') allowed`)).allowed, false)
  })
  for (const name of creators) {
    await test(`${name} preserves full function metadata and changes only the legacy INSERT value`, async () => {
      const current = await creatorState(name), old = baseline.creators[name]
      assert.deepEqual(current.metadata, old.metadata)
      const expression = "nullif(p_draft->>'partyAddressId','')::uuid"
      assert.equal(old.body.split(expression).length - 1, 1, 'exact original insertion expression')
      assert.equal(sha(current.body), sha(old.body.replace(expression, 'NULL')))
    })
  }
  for (const name of ['ediel_messages', 'ediel_route_profiles']) {
    await test(`fresh ${name} refuses a legacy address reference and rolls back`, async () => {
      let failure
      await transaction(async () => {
        const columns = name === 'ediel_messages' ? 'id,direction,message_family,party_address_id' : 'id,party_address_id'
        const values = name === 'ediel_messages' ? `${q(uid(71))},'outbound','PRODAT',${q(uid(21))}` : `${q(uid(72))},${q(uid(21))}`
        try { await db.exec(`INSERT INTO public.${name}(${columns}) VALUES(${values})`) } catch (error) { failure = error }
      })
      assert.deepEqual(await originals(), baseline.originals)
      assert.equal(failure?.code, '23514')
      assert.equal(failure?.message, 'ediel_legacy_party_address_hint_retired')
    })
    await test(`fresh ${name} accepts NULL without touching historical tuples`, async () => {
      await transaction(async () => {
        const columns = name === 'ediel_messages' ? 'id,direction,message_family,party_address_id' : 'id,party_address_id'
        const values = name === 'ediel_messages' ? `${q(uid(73))},'outbound','PRODAT',NULL` : `${q(uid(74))},NULL`
        await db.exec(`INSERT INTO public.${name}(${columns}) VALUES(${values})`)
        assert.equal((await one(`SELECT party_address_id IS NULL cleared FROM public.${name} WHERE id=${q(name === 'ediel_messages' ? uid(73) : uid(74))}`)).cleared, true)
      })
      assert.deepEqual(await originals(), baseline.originals)
    })
  }
  for (const name of ['ediel_messages', 'ediel_route_profiles']) {
    await test(`SET ROLE service_role fresh ${name} refuses a legacy address reference and rolls back`, async () => {
      let failure
      await transaction(async () => {
        await db.exec('SET LOCAL ROLE service_role')
        const columns = name === 'ediel_messages' ? 'id,direction,message_family,party_address_id' : 'id,party_address_id'
        const values = name === 'ediel_messages' ? `${q(uid(81))},'outbound','PRODAT',${q(uid(21))}` : `${q(uid(82))},${q(uid(21))}`
        try { await db.exec(`INSERT INTO public.${name}(${columns}) VALUES(${values})`) } catch (error) { failure = error }
      })
      assert.deepEqual(await originals(), baseline.originals)
      assert.equal(failure?.code, '23514')
      assert.equal(failure?.message, 'ediel_legacy_party_address_hint_retired')
    })
    await test(`SET ROLE service_role fresh ${name} accepts NULL without touching historical tuples`, async () => {
      await transaction(async () => {
        await db.exec('SET LOCAL ROLE service_role')
        const columns = name === 'ediel_messages' ? 'id,direction,message_family,party_address_id' : 'id,party_address_id'
        const values = name === 'ediel_messages' ? `${q(uid(83))},'outbound','PRODAT',NULL` : `${q(uid(84))},NULL`
        await db.exec(`INSERT INTO public.${name}(${columns}) VALUES(${values})`)
        assert.equal((await one(`SELECT party_address_id IS NULL cleared FROM public.${name} WHERE id=${q(name === 'ediel_messages' ? uid(83) : uid(84))}`)).cleared, true)
      })
      assert.deepEqual(await originals(), baseline.originals)
    })
  }
  await test('containment preserves fixture-owner updates, parent CASCADE and certificate SET NULL', async () => {
    assert.deepEqual(await lifecycle(), baseline.lifecycle)
    assert.deepEqual(await originals(), baseline.originals)
  })
  await test('historical reference UPDATE is not forbidden by an INSERT-only guard', async () => {
    await transaction(async () => {
      await db.exec(`UPDATE ediel_messages SET party_address_id=${q(uid(22))} WHERE id=${q(uid(51))};
        UPDATE ediel_route_profiles SET party_address_id=${q(uid(22))} WHERE id=${q(uid(61))}`)
      assert.equal((await one(`SELECT party_address_id FROM ediel_messages WHERE id=${q(uid(51))}`)).party_address_id, uid(22))
    })
    assert.deepEqual(await originals(), baseline.originals)
  })
  const passed = results.filter(result => result.status === 'PASS').length
  const failed = results.length - passed
  console.log(JSON.stringify({ scope: 'DB01 captured relation containment only', forwardApplied: Boolean(forward),
    schemaCommit, schemaSha256, total: results.length, passed, failed, results,
    notExecuted: ['genuine protected creator positive/source/native upgrade', ...(forward ? [] : ['actual forward conflict rollback'])] }))
  if (failed) process.exitCode = 1
} catch (error) {
  console.error(JSON.stringify({ scope: 'DB01 regression setup', status: 'ERROR', code: error.code,
    message: String(error.message).slice(0, 300) }))
  process.exitCode = 1
} finally { await db.close() }
