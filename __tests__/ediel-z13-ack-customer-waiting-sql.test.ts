// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// LOCAL_SYNTHETIC SQL component controls. The narrow fixture supplies existing
// private ACK-owner dependencies; only the new production migration is executed
// here. These controls do not qualify native receipt authority or whole cards.
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20261007232422_ediel_z13_ack_customer_waiting.sql'
let db: PGlite
const company = randomUUID(), source = randomUUID(), permission = randomUUID(), intent = randomUUID()
const actor = randomUUID(), originActor = randomUUID(), customer = randomUUID()
const raw = JSON.stringify({ family: 'PRODAT', code: 'Z13', environment: 'test',
 receiver:'54321',objects:[{li:'OWN-LI'}] })
const hash = createHash('sha256').update(raw).digest('hex')
const scopes = [{ reference: 'OWN-LI', outcome: 'positive' }]
const q = (s: string) => `'${s.replaceAll("'", "''")}'`

beforeEach(async () => {
 db = new PGlite()
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA gridex_ack_authority; CREATE SCHEMA gridex_service_permission; CREATE SCHEMA gridex_received_sources;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,
  message_family text,message_code text,intent_id uuid,raw_payload text,immutable_payload_hash text,
  immutable_rendered_at timestamptz,message_sent_at timestamptz,status text,customer_id uuid);
 CREATE TABLE public.metering_permissions(id uuid PRIMARY KEY,company_id uuid,status text,
  source_z13_message_id uuid,outbound_z13_message_id uuid,source_z14_message_id uuid,inbound_z14_message_id uuid,
  inbound_z15_message_id uuid,market_state_version bigint,permission_reference text,
  approved_start_date date,approved_end_date date,approved_start_at timestamptz,approved_end_at timestamptz,
  metadata jsonb,updated_by uuid,updated_at timestamptz,untouched jsonb,
  customer_id uuid,rff_li_reference text,grid_owner_ediel_id text);
 CREATE TABLE gridex_service_permission.origins(intent_id uuid PRIMARY KEY,company_id uuid,permission_id uuid,
  message_id uuid UNIQUE,message_code text,actor_user_id uuid,basis jsonb);
 CREATE TABLE gridex_ack_authority.source_correlations(ack_message_id uuid PRIMARY KEY,source_message_id uuid,
  company_id uuid,environment text,source_payload_hash text,ack_payload_hash text,actor_user_id uuid,
  ack_family text,ack_outcome text,ack_scope text,scope_outcomes jsonb);
 CREATE TABLE gridex_ack_authority.applied_receipts(ack_message_id uuid PRIMARY KEY,result jsonb);
 CREATE TABLE gridex_ack_authority.scope_outcomes(source_message_id uuid,ack_family text,ack_scope text,
  source_reference text,ack_message_id uuid,outcome text);
 CREATE TABLE public.synthetic_authorized_actors(id uuid PRIMARY KEY);
 INSERT INTO public.synthetic_authorized_actors VALUES(${q(actor)});
 -- Explicit component stubs, not native/canonical proof producers.
 CREATE FUNCTION gridex_ack_authority.wire_v1(text) RETURNS jsonb LANGUAGE sql AS $$SELECT $1::jsonb$$;
 CREATE FUNCTION gridex_received_sources.permission_partition_wire_v1(text) RETURNS jsonb LANGUAGE sql AS $$SELECT $1::jsonb$$;
 CREATE FUNCTION gridex_ack_authority.prodat_expected_physical_scope_keys_v1(text,uuid) RETURNS jsonb
 LANGUAGE sql AS $$SELECT '["OWN-LI"]'::jsonb$$;
 CREATE FUNCTION gridex_ack_authority.prodat_physical_outcomes_v1(text,text,uuid) RETURNS jsonb
 LANGUAGE sql AS $$SELECT $1::jsonb$$;
 CREATE FUNCTION gridex_ack_authority.require_physical_actor_v1(uuid,uuid,boolean) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF NOT EXISTS(SELECT FROM public.synthetic_authorized_actors WHERE id=$2) THEN
 RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501'; END IF; END$$;
 CREATE FUNCTION gridex_ack_authority.read_committed_v1(uuid,text,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('kind','exact_receipt','result',r.result)
 FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id)
 WHERE c.company_id=$1 AND c.environment=$2 AND c.ack_message_id=$3$$;
 INSERT INTO public.ediel_messages VALUES(${q(source)},${q(company)},'test','outbound','PRODAT','Z13',${q(intent)},
 ${q(raw)},${q(hash)},now(),now(),'acknowledged',${q(customer)});
 INSERT INTO public.metering_permissions VALUES(${q(permission)},${q(company)},'z13_ready',${q(source)},${q(source)},
 NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,'{}',NULL,'2026-01-01','{"sites":[],"grants":[],"supply":[],"customer":"synthetic"}',
 ${q(customer)},'OWN-LI','54321');
 INSERT INTO gridex_service_permission.origins VALUES(${q(intent)},${q(company)},${q(permission)},${q(source)},'Z13',${q(originActor)},${q(JSON.stringify({customerId:customer}))});
 `)
 // Before implementation this is deliberately absent: actual receipt INSERT
 // executes without a waiting projection and the positive assertion is RED.
 if (existsSync(migrationPath)) await db.exec(readFileSync(migrationPath, 'utf8'))
})
afterEach(async () => { await db.close() })

async function state() {
 return (await db.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(p) row FROM public.metering_permissions p WHERE id=$1`, [permission])).rows[0].row
}
async function ack(family: 'CONTRL' | 'APERAK', final = true, accepted = true, outcome = 'positive') {
 const id = randomUUID(), wire = JSON.stringify(scopes.map(s => ({ ...s, outcome })))
 await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound',$3,$3,NULL,$4,$5,NULL,NULL,'received',NULL)`,
 [id, company, family, wire, createHash('sha256').update(wire).digest('hex')])
 await db.query(`INSERT INTO gridex_ack_authority.source_correlations VALUES($1,$2,$3,'test',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
 [id,source,company,hash,createHash('sha256').update(wire).digest('hex'),actor,family,outcome,family === 'CONTRL' ? 'interchange' : 'object',JSON.stringify(scopes.map(s => ({ ...s, outcome })))])
 await db.query(`INSERT INTO gridex_ack_authority.scope_outcomes VALUES($1,$2,$3,'OWN-LI',$4,$5)`,
 [source,family,family === 'CONTRL' ? 'interchange' : 'object',id,outcome])
 await db.query(`INSERT INTO gridex_ack_authority.applied_receipts VALUES($1,$2::jsonb)`, [id,JSON.stringify({
 sourceMessage:{ id:source,company_id:company,environment:'test',raw_payload:raw },
 sourceAccepted:accepted,finalAckReached:final,wholeSourceRejected:false,outcome,
 scope:family === 'CONTRL' ? 'interchange' : 'object',scopeOutcomes:scopes.map(s => ({ ...s, outcome })),
 })])
 return id
}
function immutable(s: Record<string, unknown>) {
 const { status, updated_at, updated_by, ...rest } = s
 void status; void updated_at; void updated_by
 return rest
}

it.each([
 ['CONTRL','z13_ready'],['APERAK','z13_ready'],['CONTRL','z13_sent'],['APERAK','z13_sent'],
] as const)('only the first complete accepted pair changes pending status: first %s, %s',async (first,status) => {
 await db.query('UPDATE public.metering_permissions SET status=$1',[status])
 const before = await state()
 await ack(first,false,false)
 expect(await state()).toEqual(before)
 await ack(first === 'CONTRL' ? 'APERAK' : 'CONTRL')
 const after = await state()
 expect(after.status).toBe('waiting_for_customer_approval')
 expect(after.updated_by).toBe(actor)
 expect(after.updated_by).not.toBe(originActor)
 expect(immutable(after)).toEqual(immutable(before))
 await ack('APERAK')
 expect(await state()).toEqual(after)
})

it.each([
 "status='approved'", "status='denied'", "status='partially_approved'",
 "source_z14_message_id='11111111-1111-4111-8111-111111111111'",
 "inbound_z14_message_id='11111111-1111-4111-8111-111111111111'",
 "inbound_z15_message_id='11111111-1111-4111-8111-111111111111'",
 "market_state_version=1", "permission_reference='prior-decision'", "approved_start_date='2026-01-01'",
 "approved_end_date='2026-12-31'", "approved_start_at=now()", "approved_end_at=now()",
 "outbound_z13_message_id=NULL", "source_z13_message_id=NULL",
 "company_id='11111111-1111-4111-8111-111111111111'",
 `metadata='{"marketPermission":{}}'`, `metadata='{"z14":{}}'`, `metadata='{"z15":{}}'`,
 "customer_id='11111111-1111-4111-8111-111111111111'", "customer_id=NULL",
 "rff_li_reference='OTHER-LI'", "rff_li_reference=NULL", "rff_li_reference=' '",
 "grid_owner_ediel_id='FOREIGN-DSO'", "grid_owner_ediel_id=NULL",
])('preserves every already advanced or unbound permission field: %s',async change => {
 await db.exec(`UPDATE public.metering_permissions SET ${change}`)
 const before = await state()
 await ack('CONTRL',false,false); await ack('APERAK')
 expect(await state()).toEqual(before)
})

it.each(['negative','partial','missingCONTRL','missingAPERAK'])('does not project incomplete/refused aggregate: %s',async defect => {
 const before = await state()
 if (defect !== 'missingCONTRL') await ack('CONTRL',false,false)
 if (defect !== 'missingAPERAK') await ack('APERAK',defect !== 'partial',defect !== 'negative' && defect !== 'partial',defect === 'negative' ? 'negative' : 'positive')
 expect(await state()).toEqual(before)
})

it.each(['noOrigin','foreignOrigin','wrongIntent','otherCode'])('ordinary or mismatched origins remain unchanged: %s',async defect => {
 if (defect === 'noOrigin') await db.exec('DELETE FROM gridex_service_permission.origins')
 if (defect === 'foreignOrigin') await db.exec(`UPDATE gridex_service_permission.origins SET company_id=${q(randomUUID())}`)
 if (defect === 'wrongIntent') await db.exec(`UPDATE gridex_service_permission.origins SET intent_id=${q(randomUUID())}`)
 if (defect === 'otherCode') await db.exec("UPDATE gridex_service_permission.origins SET message_code='Z18'")
 const before = await state()
 await ack('CONTRL',false,false); await ack('APERAK')
 expect(await state()).toEqual(before)
})

it('never repairs historical complete success via a new distinct receipt',async () => {
 await db.exec('ALTER TABLE gridex_ack_authority.applied_receipts DISABLE TRIGGER USER')
 await ack('CONTRL',false,false); await ack('APERAK')
 await db.exec('ALTER TABLE gridex_ack_authority.applied_receipts ENABLE TRIGGER USER')
 const before = await state()
 await ack('APERAK')
 expect(await state()).toEqual(before)
})

it('late actor revocation aborts receipt insertion and preserves the permission',async () => {
 await ack('CONTRL',false,false)
 const before = await state()
 await db.exec('DELETE FROM public.synthetic_authorized_actors')
 await db.exec('BEGIN')
 await expect(ack('APERAK')).rejects.toMatchObject({ code:'42501' })
 await db.exec('ROLLBACK')
 expect(await state()).toEqual(before)
 expect((await db.query('SELECT count(*)::int n FROM gridex_ack_authority.applied_receipts')).rows).toEqual([{n:1}])
})

it.each([
 "immutable_payload_hash='wrong'", "raw_payload='{}'", "message_sent_at=NULL", "immutable_rendered_at=NULL",
])('refuses an unsealed, unsent or hash-conflicting source: %s',async change => {
 await ack('CONTRL',false,false)
 await db.exec(`UPDATE public.ediel_messages SET ${change} WHERE id=${q(source)}`)
 const before = await state()
 await db.exec('BEGIN')
 await expect(ack('APERAK')).rejects.toMatchObject({ code:'23514' })
 await db.exec('ROLLBACK')
 expect(await state()).toEqual(before)
 expect((await db.query('SELECT count(*)::int n FROM gridex_ack_authority.applied_receipts')).rows).toEqual([{n:1}])
})

it('refuses a physical APERAK projection changed from its immutable scope',async () => {
 await ack('APERAK',false,false)
 await db.exec(`UPDATE public.ediel_messages SET raw_payload='[]' WHERE message_family='APERAK'`)
 const before = await state()
 await db.exec('BEGIN')
 await expect(ack('CONTRL')).rejects.toMatchObject({ code:'23514' })
 await db.exec('ROLLBACK')
 expect(await state()).toEqual(before)
})

it('a later failure rolls back waiting and the new receipt in the same transaction',async () => {
 await ack('CONTRL',false,false)
 const before = await state()
 await db.exec('BEGIN')
 await ack('APERAK')
 expect((await state()).status).toBe('waiting_for_customer_approval')
 await expect(db.exec("DO $$BEGIN RAISE EXCEPTION 'synthetic_late_failure'; END$$")).rejects.toThrow('synthetic_late_failure')
 await db.exec('ROLLBACK')
 expect(await state()).toEqual(before)
 expect((await db.query('SELECT count(*)::int n FROM gridex_ack_authority.applied_receipts')).rows).toEqual([{n:1}])
})

it('the new private trigger function grants no service/public setter',async () => {
 const rows = await db.query<{ callable:boolean }>(`SELECT has_function_privilege('service_role',
 'gridex_service_permission.wait_after_z13_ack_v1()','EXECUTE') callable`)
 expect(rows.rows).toEqual([{callable:false}])
})
