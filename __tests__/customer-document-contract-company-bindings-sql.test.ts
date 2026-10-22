import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Actual document/contract DDL, document FKs/RLS/grants and forward SQL run in
// PGlite. Auth, customers and the public-reference generator are finite ports;
// this does not certify native JWT, full contract triggers or deployed replay.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020154131_db_customer_document_contract_company_bindings.sql', 'utf8')
const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const contract = '33333333-3333-4333-8333-333333333333'
const secondContract = '44444444-4444-4444-8444-444444444444'
const otherContract = '55555555-5555-4555-8555-555555555555'
const document = '66666666-6666-4666-8666-666666666666'
const legacyDocument = '77777777-7777-4777-8777-777777777777'
const customer = '88888888-8888-4888-8888-888888888888'
const otherCustomer = '99999999-9999-4999-8999-999999999999'
const aliases = ['contract_id', 'customer_contract_id'] as const
type Alias = typeof aliases[number]
const constraints: Record<Alias, string> = {
  contract_id: 'customer_documents_company_contract_fk',
  customer_contract_id: 'customer_documents_company_customer_contract_fk',
}
type DocumentRow = {
  id: string
  company_id: string | null
  customer_id: string | null
  contract_id: string | null
  customer_contract_id: string | null
}
let db: PGlite

function source(pattern: RegExp): string {
  const sql = schema.match(pattern)?.[0]
  if (!sql) throw new Error('Production SQL not found: ' + pattern.source)
  return sql
}

type Transaction = Pick<PGlite, 'query' | 'exec'>
async function asTenant<T>(action: (tx: Transaction) => Promise<T>): Promise<T> {
  await db.exec('savepoint tenant_action')
  try {
    await db.query("select set_config('fixture.company_id',$1,true)", [company])
    await db.exec('set local role authenticated')
    const result = await action(db)
    await db.exec('reset role; release savepoint tenant_action')
    return result
  } catch (error) {
    await db.exec('rollback to savepoint tenant_action; release savepoint tenant_action')
    throw error
  }
}

async function insert(alias: Alias, parent: string | null, owner = company) {
  return asTenant(tx => tx.query(`insert into public.customer_documents
    (id,company_id,customer_id,${alias}) values($1,$2,$3,$4)`,
  [document, owner, owner === company ? customer : otherCustomer, parent]))
}

async function row(id = document) {
  return (await db.query<DocumentRow>('select id,company_id,customer_id,contract_id,customer_contract_id from public.customer_documents where id=$1', [id])).rows[0]
}

describe('customer document contract company bindings', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role authenticated nologin;
      create role service_role nologin;
      create table public.companies(id uuid primary key);
      create table public.customers(id uuid primary key,company_id uuid);
      create function public.gridex_new_public_resource_reference(text) returns text language sql
        as $$select gen_random_uuid()::text$$;
      create function public.gridex_user_is_platform_admin() returns boolean language sql as 'select false';
      create function public.gridex_is_current_session_allowed() returns boolean language sql as 'select true';
      create function public.gridex_can_write_company(c uuid) returns boolean language sql
        as $$select c=nullif(current_setting('fixture.company_id',true),'')::uuid$$;
      create function public.gridex_can_read_company(c uuid) returns boolean language sql
        as $$select public.gridex_can_write_company(c)$$;
      create function public.gridex_user_company_ids() returns setof uuid language sql
        as $$select nullif(current_setting('fixture.company_id',true),'')::uuid$$;`)
    await db.exec(source(/ALTER TABLE ONLY public\.customers\n    ADD CONSTRAINT customers_id_company_uk [^;]+;/))
    for (const table of ['customer_contracts', 'customer_documents']) {
      await db.exec(source(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`)))
      await db.exec(source(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n    ADD CONSTRAINT ${table}_pkey [^;]+;`)))
    }
    await db.exec(source(/CREATE UNIQUE INDEX customer_contracts_company_id_id_uidx [^;]+;/))
    for (const name of ['customer_documents_company_id_fkey', 'customer_documents_contract_id_fkey', 'customer_documents_customer_company_fk']) {
      await db.exec(source(new RegExp(`ALTER TABLE ONLY public\\.customer_documents\\n    ADD CONSTRAINT ${name} [^;]+;`)))
    }
    await db.exec(source(/ALTER TABLE public\.customer_documents ENABLE ROW LEVEL SECURITY;/))
    for (const policy of schema.matchAll(/CREATE POLICY [^\n]+ ON public\.customer_documents [^\n]+;/g)) {
      await db.exec(policy[0])
    }
    await db.exec(source(/GRANT ALL ON TABLE public\.customer_documents TO authenticated;/))
    await db.exec(`alter table public.customer_contracts enable row level security;
      create policy fixture_contract_select on public.customer_contracts for select to authenticated
        using(public.gridex_can_read_company(company_id));
      grant select on public.customer_contracts to authenticated;`)
  }, 30_000)

  beforeEach(async () => {
    await db.exec('begin')
    await db.query('insert into public.companies(id) values($1),($2)', [company, otherCompany])
    await db.query('insert into public.customers(id,company_id) values($1,$2),($3,$4)', [customer, company, otherCustomer, otherCompany])
    await db.query('insert into public.customer_contracts(id,company_id) values($1,$2),($3,$2),($4,$5)', [contract, company, secondContract, otherContract, otherCompany])
    // Preserve an existing mismatched row; neither forward certifies old data.
    await db.query(`insert into public.customer_documents(id,company_id,customer_id,contract_id,customer_contract_id)
      values($1,$2,$3,$4,$4)`, [legacyDocument, company, customer, otherContract])
    // Historical rows must predate the forward transaction. PostgreSQL always
    // rechecks same-transaction inserts on UPDATE, including unchanged FK keys.
    await db.exec('commit; begin')
    await db.exec(forward)
  })
  afterEach(async () => {
    await db.exec(`rollback;
      delete from public.customer_documents;
      delete from public.customer_contracts;
      delete from public.customers;
      delete from public.companies;`)
  })
  afterAll(async () => { await db.close() })

  it('allows independent owned aliases and nullable document links', async () => {
    expect((await asTenant(tx => tx.query('select id from public.customer_contracts order by id'))).rows)
      .toEqual([{ id: contract }, { id: secondContract }])
    await asTenant(tx => tx.query(`insert into public.customer_documents
      (id,company_id,customer_id,contract_id,customer_contract_id) values($1,$2,$3,$4,$5)`,
    [document, company, customer, contract, secondContract]))
    expect(await row()).toMatchObject({ company_id: company, contract_id: contract, customer_contract_id: secondContract })
    await asTenant(tx => tx.query('update public.customer_documents set contract_id=null,customer_contract_id=null where id=$1', [document]))
    expect(await row()).toMatchObject({ company_id: company, contract_id: null, customer_contract_id: null })
  })

  it.each(aliases)('rejects an own-company insert with a foreign %s', async alias => {
    await expect(insert(alias, otherContract)).rejects.toMatchObject({ code: '23503', constraint: constraints[alias] })
    expect(await row()).toBeUndefined()
  })

  it.each(aliases)('rejects foreign reassignment of %s and retains the owned document', async alias => {
    await insert(alias, contract)
    const before = await row()
    await expect(asTenant(tx => tx.query(`update public.customer_documents set ${alias}=$1 where id=$2`, [otherContract, document])))
      .rejects.toMatchObject({ code: '23503', constraint: constraints[alias] })
    expect(await row()).toEqual(before)
  })

  it.each(aliases)('blocks a parent company change while referenced by %s', async alias => {
    await insert(alias, contract)
    await db.exec('savepoint rejected_parent_change')
    await expect(db.query('update public.customer_contracts set company_id=$1 where id=$2', [otherCompany, contract]))
      .rejects.toMatchObject({ code: '23503', constraint: constraints[alias] })
    await db.exec('rollback to savepoint rejected_parent_change')
    expect((await db.query('select company_id from public.customer_contracts where id=$1', [contract])).rows)
      .toEqual([{ company_id: company }])
    expect((await row())?.[alias]).toBe(contract)
  })

  it('nulls only the deleted contract alias and preserves document company/customer attribution', async () => {
    await asTenant(tx => tx.query(`insert into public.customer_documents
      (id,company_id,customer_id,contract_id,customer_contract_id) values($1,$2,$3,$4,$5)`,
    [document, company, customer, contract, secondContract]))
    await db.query('delete from public.customer_contracts where id=$1', [contract])
    expect(await row()).toEqual({ id: document, company_id: company, customer_id: customer, contract_id: null, customer_contract_id: secondContract })
    await db.query('delete from public.customer_contracts where id=$1', [secondContract])
    expect(await row()).toEqual({ id: document, company_id: company, customer_id: customer, contract_id: null, customer_contract_id: null })
  })

  it('preserves ownerless legacy/service rows and their plain contract-id existence/delete behavior', async () => {
    await db.query(`insert into public.customer_documents(id,company_id,contract_id,customer_contract_id)
      values($1,null,$2,$2)`, [document, contract])
    expect(await row()).toMatchObject({ company_id: null, contract_id: contract, customer_contract_id: contract })
    await db.query('delete from public.customer_contracts where id=$1', [contract])
    // The original id-only FK still cleans contract_id for NULL-company rows.
    // The independently nullable alias had no such anchor before this forward.
    expect(await row()).toMatchObject({ company_id: null, contract_id: null, customer_contract_id: contract })
    await db.exec('savepoint rejected_missing_parent')
    await expect(db.query('update public.customer_documents set contract_id=$1 where id=$2', [contract, document]))
      .rejects.toMatchObject({ code: '23503', constraint: 'customer_documents_contract_id_fkey' })
    await db.exec('rollback to savepoint rejected_missing_parent')
  })

  it('preserves the existing customer deletion behavior that nulls customer and company together', async () => {
    await insert('contract_id', contract)
    await db.query('delete from public.customers where id=$1', [customer])
    expect(await row()).toMatchObject({ company_id: null, customer_id: null, contract_id: contract })
  })

  it('preserves historical attribution without certifying either alias, including the old FK cleanup', async () => {
    const before = (await db.query('select * from public.customer_documents where id=$1', [legacyDocument])).rows[0]
    for (const alias of aliases) {
      await db.exec('savepoint rejected_validation')
      await expect(db.exec(`alter table public.customer_documents validate constraint ${constraints[alias]}`))
        .rejects.toMatchObject({ code: '23503', constraint: constraints[alias] })
      await db.exec('rollback to savepoint rejected_validation')
    }
    expect((await db.query('select * from public.customer_documents where id=$1', [legacyDocument])).rows[0]).toEqual(before)
    expect((await db.query('select conname,convalidated from pg_constraint where conrelid=$1::regclass and conname=any($2::text[]) order by conname', ['public.customer_documents', Object.values(constraints)])).rows)
      .toEqual(Object.values(constraints).sort().map(conname => ({ conname, convalidated: false })))
    await db.query('delete from public.customer_contracts where id=$1', [otherContract])
    expect(await row(legacyDocument)).toMatchObject({ company_id: company, customer_id: customer, contract_id: null, customer_contract_id: otherContract })
  })

  it('retains company RLS and the existing customer-company boundary', async () => {
    await expect(insert('contract_id', otherContract, otherCompany)).rejects.toMatchObject({ code: '42501' })
    await expect(asTenant(tx => tx.query('insert into public.customer_documents(id,company_id,customer_id) values($1,$2,$3)', [document, company, otherCustomer])))
      .rejects.toMatchObject({ code: '23503', constraint: 'customer_documents_customer_company_fk' })
    expect(await row()).toBeUndefined()
  })
})
