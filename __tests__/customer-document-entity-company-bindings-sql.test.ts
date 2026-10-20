import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Actual document/site/meter/POA/contract table DDL, parent/document FKs,
// document RLS/grants and the complete new forward run in PGlite. PostgreSQL's
// real RI triggers perform the selective DELETE actions. Auth/customer/reference
// and parent SELECT policies are finite ports. The complete e035, legal,
// partner, materialization and immutable-row trigger graphs are not installed;
// no native/JWT/full replay or end-to-end parent deletion is certified here.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020165029_db_customer_document_entity_company_bindings.sql', 'utf8')
// Declared exact original DDL from fd4acbc50e9d73c7f2f317d3e806723522708b16,
// supabase/schema.sql blob48a6e2b3ccc67cfc4ccac7bf278ec213c8a323b5,
// SHA256 a15291106e26b9bea9f70dd99f3c19f6cae7e159afd8a5d4674a997d98c2eac6.
// Later GEN exports include860/871 composite FKs; those must not constrain
// committed legacy fixtures before their separate NOT VALID installation.
const originalDocumentForeignKeys = `ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.customer_contracts(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_customer_company_fk FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id) ON UPDATE CASCADE ON DELETE SET NULL;`
const id = (value: number) => `10000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`
const company = id(1), otherCompany = id(2), customer = id(3), otherCustomer = id(4)
const contract = id(5), otherContractAlias = id(6)
const document = id(16), legacyDocument = id(17), missingLegacyDocument = id(18), missingParent = id(19)
const links = [
  { alias: 'customer_site_id', table: 'customer_sites', own: id(7), foreign: id(10), ownerless: id(13), constraint: 'customer_documents_company_customer_site_fk' },
  { alias: 'metering_point_id', table: 'metering_points', own: id(8), foreign: id(11), ownerless: id(14), constraint: 'customer_documents_company_metering_point_fk' },
  { alias: 'power_of_attorney_id', table: 'powers_of_attorney', own: id(9), foreign: id(12), ownerless: id(15), constraint: 'customer_documents_company_power_of_attorney_fk' },
] as const
type Link = typeof links[number]
type DocumentRow = {
  id: string; company_id: string | null; customer_id: string | null
  customer_site_id: string | null; metering_point_id: string | null; power_of_attorney_id: string | null
  contract_id: string | null; customer_contract_id: string | null
}
let db: PGlite

function source(pattern: RegExp) {
  const found = schema.match(pattern)?.[0]
  if (!found) throw new Error('Missing captured SQL: ' + pattern.source)
  return found
}
type Transaction = Pick<PGlite, 'query' | 'exec'>
async function asTenant<T>(action: (tx: Transaction) => Promise<T>): Promise<T> {
  await db.exec('savepoint tenant_action')
  try {
    await db.query("select set_config('fixture.company_id',$1,true)", [company])
    await db.exec('set local role authenticated')
    const result = await action(db)
    await db.exec('reset role;release savepoint tenant_action')
    return result
  } catch (error) {
    await db.exec('rollback to savepoint tenant_action;release savepoint tenant_action')
    throw error
  }
}
async function row(selected = document) {
  return (await db.query<DocumentRow>(`select id,company_id,customer_id,customer_site_id,metering_point_id,power_of_attorney_id,
    contract_id,customer_contract_id from public.customer_documents where id=$1`, [selected])).rows[0]
}
async function insert(link: Link, parent: string | null, owner = company) {
  return asTenant(tx => tx.query(`insert into public.customer_documents(id,company_id,customer_id,${link.alias}) values($1,$2,$3,$4)`,
    [document, owner, owner === company ? customer : otherCustomer, parent]))
}
async function insertAll() {
  await asTenant(tx => tx.query(`insert into public.customer_documents(id,company_id,customer_id,customer_site_id,metering_point_id,power_of_attorney_id,contract_id,customer_contract_id)
    values($1,$2,$3,$4,$5,$6,$7,$8)`, [document, company, customer, links[0].own, links[1].own, links[2].own, contract, otherContractAlias]))
}
async function rejected(action: () => Promise<unknown>, constraint: string) {
  await db.exec('savepoint rejected_change')
  await expect(action()).rejects.toMatchObject({ code: '23503', constraint })
  await db.exec('rollback to savepoint rejected_change;release savepoint rejected_change')
}

describe('customer document site, meter and POA company bindings', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role authenticated nologin;create role service_role nologin;create schema auth;
      create table auth.users(id uuid primary key);create table public.companies(id uuid primary key);
      create table public.customers(id uuid primary key,company_id uuid);
      create function public.gridex_new_public_resource_reference(text) returns text language sql as $$select gen_random_uuid()::text$$;
      create function public.gridex_user_is_platform_admin() returns boolean language sql as 'select false';
      create function public.gridex_is_current_session_allowed() returns boolean language sql as 'select true';
      create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$select c=nullif(current_setting('fixture.company_id',true),'')::uuid$$;
      create function public.gridex_can_read_company(c uuid) returns boolean language sql as $$select public.gridex_can_write_company(c)$$;
      create function public.gridex_user_company_ids() returns setof uuid language sql as $$select nullif(current_setting('fixture.company_id',true),'')::uuid$$;`)
    for (const table of ['grid_owners', 'consumption_profiles', 'customer_site_resolution', 'legal_bundle_version_documents', 'customer_onboarding_legal_snapshots', 'legal_text_versions']) {
      await db.exec(`create table public.${table}(id uuid primary key)`)
    }
    for (const name of ['gridex_normalize_facility_id', 'gridex_normalize_metering_point_id']) {
      await db.exec(source(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`)))
    }
    await db.exec(source(/ALTER TABLE ONLY public\.customers\n    ADD CONSTRAINT customers_id_company_uk [^;]+;/))
    await db.exec(source(/CREATE UNIQUE INDEX customers_company_id_id_uidx [^;]+;/))
    for (const name of ['customer_contracts', ...links.map(link => link.table), 'customer_documents']) {
      await db.exec(source(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`)))
      await db.exec(source(new RegExp(`ALTER TABLE ONLY public\\.${name}\\n    ADD CONSTRAINT ${name}_pkey [^;]+;`)))
    }
    await db.exec(source(/ALTER TABLE ONLY public\.customer_sites\n    ADD CONSTRAINT customer_sites_company_customer_id_uidx [^;]+;/))
    for (const name of ['customer_sites', 'metering_points']) await db.exec(source(new RegExp(`CREATE UNIQUE INDEX ${name}_company_id_id_uidx [^;]+;`)))
    // Parent FKs remain scoped separately from the exact original document set.
    // Unrelated parent registries above remain finite foundations.
    for (const name of links.map(link => link.table)) {
      for (const match of schema.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${name}\\n    ADD CONSTRAINT [^\\n]+FOREIGN KEY[^;]+;`, 'g'))) await db.exec(match[0])
    }
    await db.exec(originalDocumentForeignKeys)
    expect((await db.query<{ conname: string }>(`select conname from pg_constraint
      where conrelid='public.customer_documents'::regclass and contype='f' order by conname`)).rows)
      .toEqual(['customer_documents_company_id_fkey', 'customer_documents_contract_id_fkey', 'customer_documents_customer_company_fk'].map(conname => ({ conname })))
    await db.exec(source(/ALTER TABLE public\.customer_documents ENABLE ROW LEVEL SECURITY;/))
    for (const match of schema.matchAll(/CREATE POLICY [^\n]+ ON public\.customer_documents [^\n]+;/g)) await db.exec(match[0])
    await db.exec(source(/GRANT ALL ON TABLE public\.customer_documents TO authenticated;/))
    for (const link of links) await db.exec(`alter table public.${link.table} enable row level security;
      create policy fixture_parent_select on public.${link.table} for select to authenticated using(public.gridex_can_read_company(company_id));
      grant select on public.${link.table} to authenticated;`)
  }, 30_000)
  beforeEach(async () => {
    await db.exec('begin')
    await db.query('insert into public.companies values($1),($2)', [company, otherCompany])
    await db.query('insert into public.customers values($1,$2),($3,$4)', [customer, company, otherCustomer, otherCompany])
    await db.query('insert into public.customer_contracts(id,company_id) values($1,$3),($2,$3)', [contract, otherContractAlias, company])
    for (const link of links) await db.query(`insert into public.${link.table}(id,company_id) values($1,$4),($2,$5),($3,null)`,
      [link.own, link.foreign, link.ownerless, company, otherCompany])
    await db.query(`insert into public.customer_documents(id,company_id,customer_id,customer_site_id,metering_point_id,power_of_attorney_id,contract_id,customer_contract_id)
      values($1,$3,$4,$5,$6,$7,$8,$9),($2,$3,$4,$10,$10,$10,$8,$9)`,
    [legacyDocument, missingLegacyDocument, company, customer, links[0].foreign, links[1].foreign, links[2].foreign, contract, otherContractAlias, missingParent])
    // Existing mismatches predate installation. Same-transaction inserts are
    // always rechecked by PostgreSQL on UPDATE, even with unchanged FK keys.
    await db.exec('commit;begin')
    await db.exec(forward)
  })
  afterEach(async () => {
    await db.exec(`rollback;delete from public.customer_documents;delete from public.powers_of_attorney;
      delete from public.metering_points;delete from public.customer_sites;delete from public.customer_contracts;
      delete from public.customers;delete from public.companies;`)
  })
  afterAll(async () => { await db.close() })

  it('allows independent owned links, independent contract aliases and null links', async () => {
    await insertAll()
    expect(await row()).toEqual({ id: document, company_id: company, customer_id: customer,
      customer_site_id: links[0].own, metering_point_id: links[1].own, power_of_attorney_id: links[2].own,
      contract_id: contract, customer_contract_id: otherContractAlias })
    await asTenant(tx => tx.query('update public.customer_documents set customer_site_id=null,metering_point_id=null,power_of_attorney_id=null where id=$1', [document]))
    expect(await row()).toMatchObject({ company_id: company, customer_id: customer, customer_site_id: null, metering_point_id: null, power_of_attorney_id: null,
      contract_id: contract, customer_contract_id: otherContractAlias })
  })
  for (const link of links) {
    it.each(['foreign', 'missing', 'ownerless'] as const)(`rejects a new own-company ${link.alias} with a %s parent`, async variant => {
      expect((await asTenant(tx => tx.query(`select id from public.${link.table} order by id`))).rows).toEqual([{ id: link.own }])
      await expect(insert(link, variant === 'missing' ? missingParent : link[variant])).rejects.toMatchObject({ code: '23503', constraint: link.constraint })
      expect(await row()).toBeUndefined()
    })
    it(`rejects foreign reassignment of ${link.alias}`, async () => {
      await insert(link, link.own);const before = await row()
      await expect(asTenant(tx => tx.query(`update public.customer_documents set ${link.alias}=$1 where id=$2`, [link.foreign, document])))
        .rejects.toMatchObject({ code: '23503', constraint: link.constraint })
      expect(await row()).toEqual(before)
    })
    it(`blocks a parent company change while referenced by ${link.alias}`, async () => {
      await insert(link, link.own);const before = await row()
      await rejected(() => db.query(`update public.${link.table} set company_id=$1 where id=$2`, [otherCompany, link.own]), link.constraint)
      expect(await row()).toEqual(before)
      expect((await db.query(`select company_id from public.${link.table} where id=$1`, [link.own])).rows).toEqual([{ company_id: company }])
    })
    it(`blocks a document company move that would orphan ${link.alias}`, async () => {
      await insert(link, link.own);const before = await row()
      await rejected(() => db.query('update public.customer_documents set company_id=$1,customer_id=null where id=$2', [otherCompany, document]), link.constraint)
      expect(await row()).toEqual(before)
    })
    it(`a direct ${link.table} DELETE nulls only ${link.alias}`, async () => {
      await insertAll();const before = await row()
      await db.query(`delete from public.${link.table} where id=$1`, [link.own])
      expect(await row()).toEqual({ ...before, [link.alias]: null })
    })
  }
  it('keeps MATCH SIMPLE ownerless service rows and their existing unbound delete semantics', async () => {
    await db.query(`insert into public.customer_documents(id,company_id,customer_site_id,metering_point_id,power_of_attorney_id,contract_id,customer_contract_id)
      values($1,null,$2,$3,$4,$5,$6)`, [document, links[0].foreign, links[1].foreign, links[2].foreign, contract, otherContractAlias])
    const before = await row()
    for (const link of links) await db.query(`delete from public.${link.table} where id=$1`, [link.foreign])
    expect(await row()).toEqual(before)
    await db.query('update public.customer_documents set customer_site_id=$1,metering_point_id=$1,power_of_attorney_id=$1 where id=$2', [missingParent, document])
    expect(await row()).toMatchObject({ company_id: null, customer_site_id: missingParent, metering_point_id: missingParent, power_of_attorney_id: missingParent })
  })
  it('leaves committed historical mismatches and missing parents uncertified and unrepaired', async () => {
    for (const selected of [legacyDocument, missingLegacyDocument]) {
      const before = await row(selected)
      await asTenant(tx => tx.query('update public.customer_documents set title=$1 where id=$2', ['retained historical attribution', selected]))
      expect(await row(selected)).toEqual(before)
    }
    const constraints = (await db.query<{ conname: string; convalidated: boolean }>(`select conname,convalidated from pg_constraint
      where conrelid='public.customer_documents'::regclass and conname=any($1::text[]) order by conname`, [links.map(link => link.constraint)])).rows
    expect(constraints).toEqual(links.map(link => ({ conname: link.constraint, convalidated: false })).sort((a, b) => a.conname.localeCompare(b.conname)))
  })
  it('does not rewrite an old cross-company link when that foreign parent is directly deleted', async () => {
    const before = await row(legacyDocument)
    for (const link of links) await db.query(`delete from public.${link.table} where id=$1`, [link.foreign])
    expect(await row(legacyDocument)).toEqual(before)
  })
  it('retains the customer FK action that nulls customer and company together', async () => {
    await insertAll();const before = await row()
    await db.query('delete from public.customers where id=$1', [customer])
    expect(await row()).toEqual({ ...before, customer_id: null, company_id: null })
  })
  it('retains plain contract-id cleanup and independent customer_contract_id semantics', async () => {
    await insertAll();const before = await row()
    await db.query('delete from public.customer_contracts where id=$1', [contract])
    expect(await row()).toEqual({ ...before, contract_id: null })
  })
  it('preserves company RLS and the original customer-company boundary', async () => {
    await expect(insert(links[0], links[0].foreign, otherCompany)).rejects.toMatchObject({ code: '42501' })
    await expect(asTenant(tx => tx.query('insert into public.customer_documents(id,company_id,customer_id) values($1,$2,$3)', [document, company, otherCustomer])))
      .rejects.toMatchObject({ code: '23503', constraint: 'customer_documents_customer_company_fk' })
    expect(await row()).toBeUndefined()
  })
  it('installs real unvalidated RI triggers and a nonpartial POA company/id unique target', async () => {
    const constraints = (await db.query<{ conname: string; match: string; action: string; convalidated: boolean; set_columns: string[] }>(`select c.conname,c.confmatchtype as match,c.confdeltype as action,c.convalidated,
      (select array_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.confdelsetcols)) set_columns
      from pg_constraint c where c.conrelid='public.customer_documents'::regclass and c.conname=any($1::text[]) order by c.conname`, [links.map(link => link.constraint)])).rows
    expect(constraints).toEqual(links.map(link => ({ conname: link.constraint, match: 's', action: 'n', convalidated: false, set_columns: [link.alias] })).sort((a, b) => a.conname.localeCompare(b.conname)))
    const triggers = (await db.query<{ n: number }>(`select count(*)::int n from pg_trigger t join pg_constraint c on c.oid=t.tgconstraint
      where c.conrelid='public.customer_documents'::regclass and c.conname=any($1::text[]) and t.tgisinternal and t.tgenabled='O'`, [links.map(link => link.constraint)])).rows
    expect(triggers).toEqual([{ n: 12 }])
    expect((await db.query(`select i.indisunique,i.indpred is null as nonpartial,pg_get_indexdef(i.indexrelid) as definition
      from pg_index i where i.indexrelid=to_regclass('public.powers_of_attorney_company_id_id_uidx')`)).rows)
      .toEqual([{ indisunique: true, nonpartial: true, definition: 'CREATE UNIQUE INDEX powers_of_attorney_company_id_id_uidx ON public.powers_of_attorney USING btree (company_id, id)' }])
  })
})
