import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Actual forward import trigger and retained legacy unique index, PostgreSQL
// WASM. Auth/legal-label/normalization/event are finite external ports, not
// native producer, current full schema, RLS or production qualification.
const root = process.cwd()
const schema = fs.readFileSync(root + '/supabase/schema.sql', 'utf8')
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const tables = ['companies','customers','customer_contracts','contract_price_snapshots','contract_product_versions',
  'contract_publications','tenant_contract_assignments','contract_publication_versions','price_plan_versions',
  'legal_bundle_versions','legal_bundle_version_documents','customer_contract_documents','customer_contract_acceptances',
  'customer_sites','metering_points','customer_contract_evidence','customer_legal_acceptances','customer_contract_signature_requests','customer_authorization_documents']
const selected = { snapshot_schema: 'gridex_contract_pricing_v6_selection', company_id:id(1),customer_id:id(2),contract_id:id(3),
  contract_product_version_id:id(7),contract_publication_version_id:id(8),price_plan_version_id:id(9),legal_bundle_version_id:id(10),
  price_plan_id:id(14),price_book_id:id(15),price_area:'SE4',invoice_fee_sek:19,selected_component_references:['invoice-selected','hidden-certificate'],
  base_price_components_snapshot:[{source_type:'spot',price_area:'SE4',weight_percent:100}],
  price_components_snapshot:[{component_code:'invoice_fee',amount:19,metadata:{selected:true}},
    {component_code:'electricity_certificate',amount:1.7,metadata:{untouched:'EXACT'}}] }
Object.assign(selected, { base_components: selected.base_price_components_snapshot, price_components: selected.price_components_snapshot })
let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create schema auth;create schema private;create schema extensions;
    create function auth.uid() returns uuid language sql as $$select '${id(20)}'::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create function public.gridex_assert_contract_permission(uuid,text) returns void language plpgsql as $$begin return;end$$;
    
    create function public.gridex_legacy_legal_type_for_module(text) returns text language sql as $$select 'terms'::text$$;
    create table test_events(payload jsonb);
    create function public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)
      returns jsonb language plpgsql as $$begin insert into test_events values($7);return '{}'::jsonb;end$$;`)
  const normalizer = fs.readFileSync(root+'/supabase/migrations/20260819070622_pr164_review_remediation_v2.sql','utf8').match(/create or replace function private\.gridex_normalize_fixed_area_snapshot_v1\(p_snapshot jsonb\)[\s\S]*?\$\$;/)![0]
  await db.exec(normalizer)
  for (const table of tables) {
    const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))![0]
    const columns = ddl.split('\n').slice(1,-1).filter(s => /^    [a-z_][a-z0-9_]* /.test(s)).map(s => {
      let c = s.trim().replace(/,$/,'').replace(/ NOT NULL/g,'')
      if (c.includes(' GENERATED ALWAYS AS')) c = c.slice(0,c.indexOf(' GENERATED ALWAYS AS'))
      if (/DEFAULT public\./.test(c)) c = c.slice(0,c.indexOf(' DEFAULT'))
      return c.startsWith('id uuid') ? 'id uuid default gen_random_uuid() primary key' : c
    })
    await db.exec(`create table public.${table}(${columns.join(',')})`)
  }
  for (const name of ['gridex_normalize_contract_price_snapshot_row_v1','gridex_fill_contract_price_snapshot_binding_v1','gridex_enforce_contract_price_snapshot_hash_v1']) {
    await db.exec(schema.match(new RegExp('CREATE FUNCTION public\\.'+name+'\\(\\) RETURNS trigger[\\s\\S]*?\\$\\$;'))![0])
  }
  await db.exec(`create trigger aa_actual_normalize before insert on contract_price_snapshots for each row execute function gridex_normalize_contract_price_snapshot_row_v1();
    create trigger aab_actual_binding before insert on contract_price_snapshots for each row execute function gridex_fill_contract_price_snapshot_binding_v1();
    create trigger zzzz_actual_hash before insert on contract_price_snapshots for each row execute function gridex_enforce_contract_price_snapshot_hash_v1();`)
  const fee = fs.readFileSync(root+'/supabase/migrations/20261029105939_edit_unsigned_customer_contract_atomic.sql','utf8')
  await db.exec('create schema gridex_unsigned_contract_revision')
  await db.exec(fee.match(/create table gridex_unsigned_contract_revision\.price_revisions \([\s\S]*?\n\);/)![0])
  await db.exec(`create unique index contract_price_snapshots_contract_valid_from_uidx on contract_price_snapshots(company_id,contract_id,valid_from) where contract_id is not null;
    create unique index doc_dedupe on customer_contract_documents(customer_contract_id,document_type,document_sha256);
    create unique index acceptance_dedupe on customer_contract_acceptances(customer_contract_id,acceptance_sha256);
    create unique index evidence_dedupe on customer_contract_evidence(customer_contract_id,evidence_type,evidence_sha256);`)
  await db.exec(schema.match(/CREATE FUNCTION public\.gridex_normalize_customer_contract_pricing_snapshot_v1\(\) RETURNS trigger[\s\S]*?\$\$;/)![0])
  await db.exec('create trigger ab_customer_contracts_normalize_fixed_area_snapshot_v1 before insert or update of price_snapshot on customer_contracts for each row execute function gridex_normalize_customer_contract_pricing_snapshot_v1()')
  await db.exec(fs.readFileSync(root+'/supabase/migrations/20261029173552_preserve_imported_agreement_selected_pricing.sql','utf8'))
  await db.exec(`create trigger actual_import after insert on customer_authorization_documents for each row execute function gridex_finalize_admin_imported_signed_agreement_v1();
    insert into companies(id) values('${id(1)}');insert into customers(id,company_id) values('${id(2)}','${id(1)}');
    insert into tenant_contract_assignments(id,company_id) values('${id(11)}','${id(1)}');
    insert into contract_publications(id,assignment_id) values('${id(12)}','${id(11)}');
    insert into contract_product_versions(id,status,locked_at,pricing_model) values('${id(7)}','approved',now(),'spot');
    insert into price_plan_versions(id,status,locked_at) values('${id(9)}','published',now());
    insert into legal_bundle_versions(id,company_id,status,locked_at,unresolved_variables) values('${id(10)}','${id(1)}','published',now(),'{}');
    insert into contract_publication_versions(id,contract_publication_id,contract_product_version_id,price_plan_version_id,legal_bundle_version_id,status,locked_at)
      values('${id(8)}','${id(12)}','${id(7)}','${id(9)}','${id(10)}','published',now());
    insert into legal_bundle_version_documents(id,legal_bundle_version_id,module_key,title,content_sha256)
      values('${id(13)}','${id(10)}','supplier_terms','Synthetic terms',repeat('a',64));`)
  await db.query(`insert into customer_contracts(id,company_id,customer_id,status,starts_at,contract_name,contract_type,energy_direction,
    contract_product_version_id,contract_publication_version_id,price_plan_version_id,legal_bundle_version_id,contract_price_snapshot_id,price_plan_id,price_book_id,
    price_snapshot,commercial_snapshot,legal_snapshot,invoice_fee_sek)
    values($1,$2,$3,'pending_signature',current_date,'Synthetic selected contract','variable_monthly','consumption',
    $4,$5,$6,$7,$8,'${id(14)}','${id(15)}',$9::jsonb,$10::jsonb,'{"terms":"CURRENT"}',19)`,
    [id(3),id(1),id(2),id(7),id(8),id(9),id(10),id(4),JSON.stringify(selected),JSON.stringify({price_components_snapshot:[{component_code:'invoice_fee',amount:99,metadata:{notSelected:true}}]})])
  await db.query(`insert into contract_price_snapshots(id,company_id,customer_id,contract_id,price_plan_version_id,source,valid_from,snapshot_json,snapshot_hash,
    base_price_components_snapshot,price_components_snapshot,snapshot_quality,snapshot_schema_version,selected_component_references,price_option_reference,invoice_delivery_method,price_plan_id,price_book_id)
    values($1,$2,$3,$4,$5,'internal_customer_contract_selection',current_date,$6::jsonb,encode(sha256(convert_to(($6::jsonb)::text,'UTF8')),'hex'),$7::jsonb,$8::jsonb,'canonical','gridex_contract_pricing_v6_selection',array['invoice-selected','hidden-certificate'],'OPTION-EXACT','email','${id(14)}','${id(15)}')`,
    [id(4),id(1),id(2),id(3),id(9),JSON.stringify(selected),JSON.stringify(selected.base_price_components_snapshot),JSON.stringify(selected.price_components_snapshot)])
})
afterEach(async () => { await db.close() })

async function importPdf() {
  await db.query(`insert into customer_authorization_documents(company_id,customer_id,customer_contract_id,document_type,status,storage_bucket,file_path,file_checksum,mime_type,created_by,metadata)
    values($1,$2,$3,'complete_agreement','active','customer-documents','synthetic/signed.pdf',repeat('b',64),'application/pdf',$4,'{"source":"customer_intake","documentRole":"signed_agreement"}')`,[id(1),id(2),id(3),id(20)])
}
async function state() {
  const { rows } = await db.query(`select (select count(*)::int from contract_price_snapshots) ledgers, c.status,c.contract_price_snapshot_id,
    c.signature_snapshot,s.snapshot_json,s.price_option_reference,s.invoice_delivery_method from customer_contracts c join contract_price_snapshots s on s.id=c.contract_price_snapshot_id where c.id='${id(3)}'`)
  return rows[0] as Record<string, unknown>
}

describe('actual imported selected-contract ledger', () => {
  it('signs against the existing selected receipt without a second same-date ledger', async () => {
    await importPdf()
    expect(await state()).toMatchObject({ ledgers:1,status:'signed',contract_price_snapshot_id:id(4),snapshot_json:selected,price_option_reference:'OPTION-EXACT',invoice_delivery_method:'email' })
  })

  it('retains exact selected components even when the unique-index symptom is removed in this isolated fixture', async () => {
    await db.exec('drop index contract_price_snapshots_contract_valid_from_uidx')
    await importPdf()
    expect((await state()).snapshot_json).toEqual(selected)
  })

  it.each([
    ["update contract_price_snapshots set snapshot_json=jsonb_set(snapshot_json,'{price_components}','[]'), snapshot_hash=encode(sha256(convert_to(jsonb_set(snapshot_json,'{price_components}','[]')::text,'UTF8')),'hex')", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
    ["update contract_price_snapshots set snapshot_schema_version='gridex_contract_pricing_v7_signed_receipt'", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
    ["update contract_price_snapshots set customer_id='"+id(99)+"'", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
    ["update customer_contracts set contract_price_snapshot_id=null", 'admin_signed_contract_import_current_receipt_pointer_missing'],
    ["update contract_price_snapshots set snapshot_hash=repeat('c',64)", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
    ["update contract_price_snapshots set price_plan_version_id='"+id(99)+"'", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
    ["update contract_price_snapshots set price_components_snapshot='[]'", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
    ["update contract_price_snapshots set snapshot_quality='thin'", 'admin_signed_contract_import_existing_receipt_requires_reconciliation'],
  ])('holds inconsistent pre-existing evidence and rolls the entire import back: %s', async (fault, message) => {
    // Deliberately inconsistent isolated fixture; do not weaken real guards.
    await db.exec(fault)
    const before = await db.query('select to_jsonb(c) row from customer_contracts c')
    const prices = await db.query('select to_jsonb(s) row from contract_price_snapshots s')
    await expect(importPdf()).rejects.toMatchObject({ code:'23514', message })
    expect((await db.query('select to_jsonb(c) row from customer_contracts c')).rows).toEqual(before.rows)
    expect((await db.query('select to_jsonb(s) row from contract_price_snapshots s')).rows).toEqual(prices.rows)
    for (const table of ['customer_authorization_documents','customer_contract_documents','customer_contract_acceptances','customer_contract_evidence','test_events']) {
      expect((await db.query<{n:number}>(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0)
    }
  })

  it('holds and rolls back if the real installed normalization changes the frozen receipt on UPDATE', async () => {
    await db.exec(`with changed as (
      select id, snapshot_json || jsonb_build_object('base_components',a,'base_price_components_snapshot',a) j
      from contract_price_snapshots cross join lateral (select '[{"source_type":"fixed","price_area":"SE1","amount":80},{"source_type":"fixed","price_area":"SE4","amount":90}]'::jsonb a) q
    ) update contract_price_snapshots s set snapshot_json=c.j,base_price_components_snapshot=c.j->'base_components',
      snapshot_hash=encode(sha256(convert_to(c.j::text,'UTF8')),'hex') from changed c where c.id=s.id`)
    const before = await db.query('select to_jsonb(c) row from customer_contracts c')
    const prices = await db.query('select to_jsonb(s) row from contract_price_snapshots s')
    await expect(importPdf()).rejects.toMatchObject({ code:'23514', message:'admin_signed_contract_import_receipt_changed_after_normalization' })
    expect((await db.query('select to_jsonb(c) row from customer_contracts c')).rows).toEqual(before.rows)
    expect((await db.query('select to_jsonb(s) row from contract_price_snapshots s')).rows).toEqual(prices.rows)
    expect((await db.query<{n:number}>('select count(*)::int n from customer_authorization_documents')).rows[0].n).toBe(0)
  })
})

async function makeControlledRevision(provenance = true) {
  await db.exec(`update contract_price_snapshots set source='customer_contract_unsigned_edit',snapshot_schema_version='gridex_unsigned_contract_edit_v1',
    snapshot_json=snapshot_json||'{"snapshot_schema":"gridex_unsigned_contract_edit_v1","schema_version":"gridex_unsigned_contract_edit_v1","source":"customer_contract_unsigned_edit"}'::jsonb;
    update contract_price_snapshots set snapshot_hash=encode(sha256(convert_to(snapshot_json::text,'UTF8')),'hex');
    insert into contract_price_snapshots(id,company_id,customer_id,contract_id,valid_from,source) values('${id(90)}','${id(1)}','${id(2)}','${id(3)}',current_date-1,'internal_customer_contract_selection');`)
  if(provenance) await db.exec(`insert into gridex_unsigned_contract_revision.price_revisions(snapshot_id,company_id,customer_id,contract_id,price_plan_version_id,original_snapshot_id,actor_user_id,edit_id,creating_txid)
    values('${id(4)}','${id(1)}','${id(2)}','${id(3)}','${id(9)}','${id(90)}','${id(20)}','${id(91)}',0)`)
}

describe('uploaded signed PDF for a controlled unsigned revision',()=>{
 it('reuses the actual revision receipt and older immutable provenance from its creation transaction',async()=>{
  await makeControlledRevision()
  await importPdf()
  expect(await state()).toMatchObject({ledgers:2,status:'signed',contract_price_snapshot_id:id(4)})
  const result=await state();expect((result.snapshot_json as Record<string,unknown>).price_components_snapshot).toEqual(selected.price_components_snapshot)
 })
 it('refuses a caller-selected revision label without private immutable provenance',async()=>{
  await makeControlledRevision(false)
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_existing_receipt_requires_reconciliation')
  expect(await state()).toMatchObject({status:'pending_signature',ledgers:2})
 })
})

describe('controlled revision scope guards',()=>{
 it.each(['company_id','customer_id','contract_id','price_plan_version_id'])('holds mismatched private %s provenance',async(column)=>{
  await makeControlledRevision()
  await db.exec(`update gridex_unsigned_contract_revision.price_revisions set ${column}='${id(99)}'`)
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_existing_receipt_requires_reconciliation')
  expect(await state()).toMatchObject({status:'pending_signature',contract_price_snapshot_id:id(4),ledgers:2})
 })
 it('holds a revision schema disguised as an ordinary selected receipt',async()=>{
  await makeControlledRevision()
  await db.exec("update contract_price_snapshots set source='internal_customer_contract_selection' where id='"+id(4)+"'")
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_existing_receipt_requires_reconciliation')
 })
})

describe('legacy intake with ambiguous thin pricing',()=>{
 it.each(['null','current_date'])('holds a thin receipt at %s rather than replacing selected fees from the master',async(date)=>{
  await db.exec(`update contract_price_snapshots set snapshot_quality=null,snapshot_schema_version=null,valid_from=${date},
    snapshot_json='{"invoiceFeeSek":19}'::jsonb,price_components_snapshot='[{"component_code":"invoice_fee","amount":99}]'::jsonb`)
  const before=await db.query('select to_jsonb(s) row from contract_price_snapshots s order by id')
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_existing_receipt_requires_reconciliation')
  expect((await db.query('select to_jsonb(s) row from contract_price_snapshots s order by id')).rows).toEqual(before.rows)
  expect(await state()).toMatchObject({status:'pending_signature',contract_price_snapshot_id:id(4)})
  expect((await db.query('select count(*)::int n from customer_contract_documents')).rows[0]).toMatchObject({n:0})
 })
})

describe('staff-editable JSON is not immutable pricing evidence',()=>{
 it('holds complete-looking selected JSON without its canonical receipt',async()=>{
  await db.exec('update customer_contracts set contract_price_snapshot_id=null;delete from contract_price_snapshots')
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_current_receipt_requires_reconciliation')
  expect((await db.query('select status from customer_contracts')).rows[0]).toMatchObject({status:'pending_signature'})
 })
})

describe('unproven fallback pricing',()=>{
 it('holds missing customer receipt and scalar-only pricing instead of importing master fees',async()=>{
  await db.exec(`update customer_contracts set contract_price_snapshot_id=null,price_snapshot='{"invoiceFeeSek":19}'::jsonb;delete from contract_price_snapshots`)
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_current_receipt_requires_reconciliation')
  expect((await db.query('select status from customer_contracts')).rows[0]).toMatchObject({status:'pending_signature'})
  expect((await db.query('select count(*)::int n from contract_price_snapshots')).rows[0]).toMatchObject({n:0})
 })
})

describe('actual CPS insert normalization cannot replace intended customer pricing',()=>{
 it('rolls back when the real binder fills empty customer components from conflicting master components',async()=>{
  // Finite materializer output port; the real CPS binder/normalizer/hash
  // still execute. Full real authoring is separately required in native tests.
  await db.exec(`create function public.gridex_prepare_manual_contract_binding(uuid,jsonb,jsonb,uuid) returns jsonb language sql as $$
    select jsonb_build_object('contract_product_version_id','${id(7)}','contract_publication_version_id','${id(8)}',
      'price_plan_version_id','${id(9)}','legal_bundle_version_id','${id(10)}','price_plan_id','${id(14)}','price_book_id','${id(15)}',
      'commercial_snapshot','{"price_components_snapshot":[{"component_code":"invoice_fee","amount":99}]}'::jsonb,'legal_snapshot','{"terms":"CURRENT"}'::jsonb)
    $$;`)
  await db.exec(`update customer_contracts set contract_price_snapshot_id=null,contract_offer_id=null,source_type='manual_override',
    contract_product_version_id=null,contract_publication_version_id=null,price_plan_version_id=null,legal_bundle_version_id=null,
    price_snapshot=jsonb_set(jsonb_set(price_snapshot,'{price_components_snapshot}','[]'),'{price_components}','[]');delete from contract_price_snapshots`)
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_normalized_components_changed')
  expect((await db.query('select status from customer_contracts')).rows[0]).toMatchObject({status:'pending_signature'})
  expect((await db.query('select count(*)::int n from contract_price_snapshots')).rows[0]).toMatchObject({n:0})
 })
})

describe('fresh customer-selection identity and schema coherence',()=>{
 it.each(['schema_version','company_id','customer_id','contract_id','price_plan_id','price_book_id'])('holds conflicting %s instead of overwriting the contradiction',async(field)=>{
  await db.query(`update customer_contracts set contract_price_snapshot_id=null,price_snapshot=jsonb_set(price_snapshot,array[$1],to_jsonb($2::text))`,[field,field==='schema_version'?'unknown_schema':id(99)])
  await db.exec('delete from contract_price_snapshots')
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_current_receipt_requires_reconciliation')
  expect((await db.query('select status from customer_contracts')).rows[0]).toMatchObject({status:'pending_signature'})
 })
})

describe('missing receipt pointer with retained legacy history',()=>{
 it('holds instead of replacing or colliding with an existing noncanonical receipt',async()=>{
  await db.exec('update customer_contracts set contract_price_snapshot_id=null;update contract_price_snapshots set snapshot_quality=null')
  await expect(importPdf()).rejects.toThrow('admin_signed_contract_import_current_receipt_pointer_missing')
  expect((await db.query('select status from customer_contracts')).rows[0]).toMatchObject({status:'pending_signature'})
 })
})
