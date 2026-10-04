// masterplan: TEN-07, AT-TEN-07, ESCO-10, AT-ESCO-10, ESCO-11, AT-ESCO-11
// Real scoped projection/grant/receipt consumers over the existing explicitly
// finite source, accepted-storage and legal-review dependency fixture. This
// proves consumer effects; it is not native replay or market/legal activation.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const base = readFileSync(new URL('./ediel-beneficiary-projection-provenance-sql-regression.mjs', import.meta.url), 'utf8')
const marker = " console.log('Projection provenance SQL:"
assert.equal(base.split(marker).length, 2)
const extension = String.raw`
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql',import.meta.url),'utf8'))
 // TEN-07: two accepted-storage fixture transactions share one owner source;
 // the beneficiary has a grant for point-a only. No parser/acceptance authority
 // is invented here: the upstream contract port remains explicitly synthetic.
 await db.query("INSERT INTO companies VALUES($1,'active')",[uid(4)])
 await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[uid(4),uid(20)])
 await db.query('INSERT INTO metering_points(id,company_id,ediel_metering_point_id) VALUES($1,$2,$3)',[uid(700),uid(4),'point-a'])
 await db.query("INSERT INTO meter_reading_series SELECT (jsonb_populate_record(NULL::meter_reading_series,to_jsonb(s)||jsonb_build_object('id',$1::text,'external_metering_point_id','point-b'))).* FROM meter_reading_series s WHERE id=$2",[uid(701),uid(211)])
 await db.query("INSERT INTO gridex_utilts_binding.contracts SELECT (jsonb_populate_record(NULL::gridex_utilts_binding.contracts,to_jsonb(c)||jsonb_build_object('series_id',$1::text,'transaction_id','tx-b','contract',jsonb_set(c.contract,'{observations,0,externalPoint}','\"point-b\"')))).* FROM gridex_utilts_binding.contracts c WHERE series_id=$2",[uid(701),uid(211)])
 await db.query("UPDATE gridex_utilts_binding.contracts SET contract_hash=encode(sha256(convert_to(contract::text,'UTF8')),'hex') WHERE series_id=$1",[uid(701)])
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2025-12-31',1.000,'KWH','56','220'),($4,$2,$3,'2026-01-15',20.000,'KWH','56','220'),($5,$2,$3,'2026-02-01',30.000,'KWH','56','220'),($6,$2,$7,'2026-01-02',99.000,'KWH','56','220')",[uid(710),uid(1),uid(211),uid(711),uid(712),uid(713),uid(701)])
 const ownerState=async()=>(await db.query("SELECT jsonb_build_object('sources',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM ediel_messages m),'series',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM meter_reading_series s),'values',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM meter_reading_values v),'acks',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.source_message_id,a.source_transaction_id) FROM ediel_ack_transaction_results a),'marketReceipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.ack_raw_hash) FROM gridex_ediel_ack_replay.positive_service_scope_receipts r)) state")).rows[0].state
 const originalState=await ownerState()
 const source=originalState.sources.find(row=>row.id===uid(210))
 assert.equal(source.company_id,uid(1));assert.ok(source.raw_payload)
 let ten07Checks=0
 const effect=async fn=>{await fn();assert.deepEqual(await ownerState(),originalState);ten07Checks++}
 const scopedPage=async({beneficiary=uid(2),grantId=grant.grantId,purpose='analysis',seriesId=uid(211),fields=['quantity'],start='2026-01-01',end='2026-02-01'}={})=>(await db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8) page',[beneficiary,uid(20),grantId,purpose,seriesId,fields,start,end])).rows[0].page
 await effect(async()=>{
  const page=await scopedPage()
  assert.deepEqual(page.rows,[{quantity:'17.250'},{quantity:'20.000'}])
  assert.equal(page.provenance.sourceMessageId,uid(210));assert.equal(page.provenance.purpose,'analysis')
  assert.deepEqual(page.provenance.fields,['quantity'])
  assert.equal(JSON.stringify(page).includes(source.raw_payload),false)
  for(const forbidden of ['raw_payload','observations','company_id','point-b','99.000','quality":"56'])assert.equal(JSON.stringify(page).includes(forbidden),false)
 })
 await effect(async()=>{await assert.rejects(scopedPage({seriesId:uid(701)}),/series_outside_grant/)})
 await effect(async()=>{await assert.rejects(scopedPage({fields:['quantity','quality']}),/projection_outside_grant/);await assert.rejects(scopedPage({fields:['raw_payload']}),/projection_outside_grant/)})
 await effect(async()=>{await assert.rejects(scopedPage({purpose:'billing'}),/projection_outside_grant/)})
 await effect(async()=>{await assert.rejects(scopedPage({start:'2025-12-31'}),/projection_outside_grant/);await assert.rejects(scopedPage({end:'2027-01-02'}),/projection_outside_grant/)})
 const changedOwner=async(sql,pattern)=>{await db.exec('BEGIN');try{await db.exec(sql);await assert.rejects(scopedPage(),pattern)}finally{await db.exec('ROLLBACK')}}
 await effect(()=>changedOwner("UPDATE meter_reading_series SET product_id='other-product' WHERE id='"+uid(211)+"'",/series_outside_grant/))
 await effect(()=>changedOwner("UPDATE metering_permission_sites SET end_at='2026-01-15'",/permission_object_not_approved/))
 await effect(()=>changedOwner("UPDATE metering_permission_sites SET metadata=jsonb_set(metadata,'{product}','\"other-product\"')",/permission_object_not_approved/))
 await effect(()=>changedOwner("UPDATE source_authority_fixture SET allowed=false",/permission_source_not_current/))
 await effect(()=>changedOwner("UPDATE meter_reading_series SET series_kind='estimated' WHERE id='"+uid(211)+"'",/series_outside_grant/))
 await effect(()=>changedOwner("UPDATE ediel_messages SET message_code='E31' WHERE id='"+uid(210)+"'",/source_unqualified|source_actor_not_qualified|captured_role/))
 await effect(()=>changedOwner("UPDATE gridex_ediel_inbound_context.fixture SET basis=jsonb_set(basis,'{canonicalProjection,receiverRoles}','[\"electricity_supplier\"]') WHERE message_id='"+uid(210)+"'",/source_unqualified|captured_role/))
 await effect(()=>changedOwner("UPDATE ediel_messages SET raw_payload=replace(raw_payload,'NAD+MS+54321','NAD+MS+99999') WHERE id='"+uid(210)+"'",/source_dso_not_qualified/))
 await effect(()=>changedOwner("UPDATE metering_permissions SET metadata=jsonb_set(metadata,'{marketPermission,legalActor}','\"99999\"')",/permission_legal_actor_mismatch/))
 await effect(()=>changedOwner("UPDATE metering_permissions SET metadata=jsonb_set(metadata,'{marketPermission,dsoActor}','\"99999\"')",/permission_legal_actor_mismatch/))
 // An active beneficiary with the same GSRN but no grant cannot use another
 // beneficiary's capability. The existing unregistered-actor test is separate.
 await effect(async()=>{await assert.rejects(scopedPage({beneficiary:uid(4)}),/no rows|query returned no rows/)})
 await effect(async()=>{
  const quality=await scopedPage({beneficiary:uid(3),grantId:grant2.grantId,purpose:'quality-monitoring',fields:['quality']})
  assert.deepEqual(quality.rows,[{quality:'56'},{quality:'56'}])
  assert.equal(quality.provenance.sourceMessageId,uid(210))
  assert.notEqual(quality.consumerReceiptId,(await scopedPage()).consumerReceiptId)
 })
 console.log('PASS '+ten07Checks+' TEN-07 scoped-object/window/field/raw-owner effects; real SQL consumer, finite synthetic upstream dependencies')
 // Restore only added fixture rows for the unchanged parent administration
 // assertions. The production consumer and original source bytes stay intact.
 await db.query('DELETE FROM meter_reading_values WHERE id=ANY($1::uuid[])',[[uid(710),uid(711),uid(712),uid(713)]])
 await db.query('DELETE FROM meter_reading_series WHERE id=$1',[uid(701)])
 await db.query('DELETE FROM gridex_utilts_binding.contracts WHERE series_id=$1',[uid(701)])
`
const source = base.replace(marker, () => extension + marker)
  .replaceAll('.ediel-projection-provenance', '.ediel-ten07-projection')
const temporary = fileURLToPath(new URL('./.ediel-ten07-scoped-outer.tmp.mjs', import.meta.url))
writeFileSync(temporary, source)
try {
  const run = spawnSync(process.execPath, [temporary], { stdio: 'inherit', env: process.env })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
} finally {
  unlinkSync(temporary)
}
