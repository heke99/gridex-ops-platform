// Actual 00610 customer original producer and new 071000 invoice table/receipt;
// actual new 071500 guards. Declared synthetic auth/issuer/source boundaries.
// No approved customer, market owner or real legal evidence is seeded.
import {readFileSync} from 'node:fs'
const own=new URL('../supabase/migrations/',import.meta.url)
let base=readFileSync(new URL('./ediel-decision-evidence-sql-regression.mjs',import.meta.url),'utf8').replace("const own=new URL('../supabase/migrations/',import.meta.url)",`const own=new URL(${JSON.stringify(own.href)})`)
const end=base.indexOf(" console.log(JSON.stringify({status:'PASS',checks,scope:'six actual original-byte namespaces")
if(end<0)throw Error('bounded predecessor boundary changed');base=base.slice(0,end)
const phase=String.raw`
{
 const customer='20261001000610_ediel_customer_class_retention.sql',invoice=process.env.GRIDEX_INVOICE_FILE_RETENTION_DDL?new URL('file://'+process.env.GRIDEX_INVOICE_FILE_RETENTION_DDL):new URL('20261001071000_ediel_invoice_file_copy_class_retention.sql',own)
 const table=(file,name)=>{const all=readFileSync(new URL(file,own),'utf8'),start=all.indexOf('CREATE TABLE '+name+'(');if(start<0)throw Error('actual table missing '+name);return all.slice(start,all.indexOf(';',start)+1)}
 await db.exec('CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid,name text);')
 for(const tab of ['customer_decisions','customer_revocations'])await db.exec(table(customer,'gridex_ediel_retention.'+tab))
 for(const tab of ['invoice_file_catalog','invoice_file_sources','invoice_file_decisions','invoice_file_revocations'])await db.exec(table(invoice,'gridex_ediel_retention.'+tab))
 for(const tab of ['customer_decisions','customer_revocations','invoice_file_catalog','invoice_file_sources','invoice_file_decisions','invoice_file_revocations'])await db.exec('ALTER TABLE gridex_ediel_retention.'+tab+' OWNER TO gridex_ediel_retention_owner')
 await db.exec('GRANT SELECT,UPDATE ON public.customers TO gridex_ediel_retention_owner;CREATE TRIGGER customer_decisions_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.customer_decisions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.invoice_file_decisions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();')
 for(const name of ['customer_personal_fields_v1','customer_receipt_v1'])await db.exec(source(customer,'gridex_ediel_retention.'+name))
 await db.exec(source(customer,'public.ediel_submit_customer_retention_v1'))
 await db.exec(source(invoice,'gridex_ediel_retention.invoice_file_receipt_v1'))
 // Genuine original producer body, under a specifically DECLARED auth port.
 // No authentic issuer receipt means unqualified custody, not customer erasure.
 await db.exec('INSERT INTO public.customers VALUES('+q(id(80))+','+q(id(1))+",'Synthetic own archived customer');INSERT INTO public.synthetic_grants VALUES("+q(id(1))+','+q(id(2))+",'customers.write',true)")
 const customerBytes=Buffer.from('SYNTHETIC own archived customer legal-original'),customerOriginal=await call('ediel_submit_customer_retention_v1',[id(1),id(2),id(80),customerBytes.toString('base64'),null]);check(customerOriginal.issuerQualified,false)
 const invoiceBytes=Buffer.from('SYNTHETIC unapproved invoice copy legal-original'),invoiceTarget=id(83)
 await db.exec("INSERT INTO gridex_ediel_retention.invoice_file_catalog VALUES('customer_invoice_pdf_bytes','customer_invoices','pdf_path');INSERT INTO gridex_ediel_retention.invoice_file_sources(id,company_id,retention_class,target_id,target_hash,storage_object_id,storage_bucket,storage_path,source_hash,byte_length,captured_by) VALUES("+[q(id(82)),q(id(1)),"'customer_invoice_pdf_bytes'",q(id(81)),q('a'.repeat(64)),q(id(84)),"'customer-documents'","'SYNTHETIC finite storage-capture boundary'",q('b'.repeat(64)),16,q(id(2))].join(',')+');')
 // This unapproved source fixture is explicitly not a Storage capture/native
 // positive receipt. Only decision-original custody mechanics are measured.
 await db.exec('INSERT INTO gridex_ediel_retention.invoice_file_decisions(id,company_id,retention_class,target_id,source_id,source_hash,target_hash,scope_hash,document_bytes,document_hash,submitted_by) VALUES('+[q(invoiceTarget),q(id(1)),"'customer_invoice_pdf_bytes'",q(id(81)),q(id(82)),q('b'.repeat(64)),q('a'.repeat(64)),q('c'.repeat(64)),"decode('"+invoiceBytes.toString('hex')+"','hex')",q(hash(invoiceBytes)),q(id(2))].join(',')+');')
 for(const [kind,target] of [['customer_retention_decision_original_bytes',customerOriginal.decisionId],['invoice_file_retention_decision_original_bytes',invoiceTarget]]){await assert.rejects(()=>call('ediel_read_retention_decision_original_v1',[id(1),id(2),kind,target,false]),/no rows|class_grant/);checks++}
 const receiptIdentities=(await db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid IN('gridex_ediel_retention.customer_receipt_v1(gridex_ediel_retention.customer_decisions)'::regprocedure,'gridex_ediel_retention.invoice_file_receipt_v1(gridex_ediel_retention.invoice_file_decisions)'::regprocedure) ORDER BY oid")).rows
 await db.exec(readFileSync(new URL('20261001071500_ediel_customer_invoice_retention_decision_original_classes.sql',own),'utf8'))
 check((await db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid IN('gridex_ediel_retention.customer_receipt_v1(gridex_ediel_retention.customer_decisions)'::regprocedure,'gridex_ediel_retention.invoice_file_receipt_v1(gridex_ediel_retention.invoice_file_decisions)'::regprocedure) ORDER BY oid")).rows,receiptIdentities)
 check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.decision_evidence_catalog')).rows[0].n,8)
 for(const [kind,tab,target,bytes,receiptName] of [['customer_retention_decision_original_bytes','customer_decisions',customerOriginal.decisionId,customerBytes,'customer_receipt_v1'],['invoice_file_retention_decision_original_bytes','invoice_file_decisions',invoiceTarget,invoiceBytes,'invoice_file_receipt_v1']]){
  const basis=(await db.query('SELECT gridex_ediel_retention.decision_evidence_basis_v1('+q(id(1))+','+q(kind)+','+q(target)+') b')).rows[0].b,document=Buffer.from('SYNTHETIC independent '+kind+' policy'),policy=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),kind,target,document.toString('base64'),signed(basis,document)]);check(policy.issuerQualified,true)
  await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),policy.policyId,'approve','SYNTHETIC separate own-original class review'])).status,'approved');await actor(2)
  check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),policy.policyId])).bytesAvailable,false)
  check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),policy.policyId])).replay,true)
  check((await call('ediel_read_retention_decision_original_v1',[id(1),id(2),kind,target,true])).documentHash,hash(bytes))
  check((await db.query('SELECT gridex_ediel_retention.'+receiptName+'(d) r FROM gridex_ediel_retention.'+tab+' d WHERE id='+q(target))).rows[0].r,null)
  await assert.rejects(()=>db.exec('DELETE FROM gridex_ediel_retention.'+tab+' WHERE id='+q(target)),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
  await assert.rejects(()=>db.exec("UPDATE gridex_ediel_retention."+tab+" SET document_bytes=decode('41','hex') WHERE id="+q(target)),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
 }
 // Distinct actual customer-original producer receipts for finite late-write
 // denial/expiry probes. This is not a native two-session race fixture.
 for(const mode of ['late_permission','late_expiry']){
  const bytes=Buffer.from('SYNTHETIC customer late original '+mode),archive=await call('ediel_submit_customer_retention_v1',[id(1),id(2),id(80),bytes.toString('base64'),null]),kind='customer_retention_decision_original_bytes',target=archive.decisionId,basis=(await db.query('SELECT gridex_ediel_retention.decision_evidence_basis_v1('+q(id(1))+','+q(kind)+','+q(target)+') b')).rows[0].b,document=Buffer.from('SYNTHETIC customer finite late policy '+mode),policy=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),kind,target,document.toString('base64'),signed(basis,document,mode==='late_expiry'?{expiresAt:new Date(Date.now()+2000).toISOString()}:{})])
  await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),policy.policyId,'approve','SYNTHETIC separate late original review'])).status,'approved');await actor(2)
  const action=mode==='late_permission'?"UPDATE public.user_permissions SET effect='deny' WHERE user_id="+q(id(3))+" AND permission_key='ediel.retention.record_decision_evidence';":'PERFORM pg_sleep(2.1);'
  await db.exec('CREATE FUNCTION gridex_ediel_retention.synthetic_customer_late_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF NEW.target_id='+q(target)+'::uuid THEN '+action+'END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_customer_late_probe AFTER INSERT ON gridex_ediel_retention.decision_evidence_tombstones FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.synthetic_customer_late_probe();')
  await assert.rejects(()=>call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),policy.policyId]),mode==='late_permission'?/current_reviewer/:/received_source_evidence_is_append_only/);checks++
  check((await db.query('SELECT document_bytes IS NOT NULL b FROM gridex_ediel_retention.customer_decisions WHERE id='+q(target))).rows[0].b,true)
  check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.decision_evidence_tombstones WHERE target_id='+q(target))).rows[0].n,0)
  check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.customer_revocations WHERE decision_id='+q(target))).rows[0].n,0)
  await db.exec('DROP TRIGGER synthetic_customer_late_probe ON gridex_ediel_retention.decision_evidence_tombstones;DROP FUNCTION gridex_ediel_retention.synthetic_customer_late_probe();')
 }
 console.log(JSON.stringify({status:'PASS',checks,scope:'published six-original regression plus actual00610 customer producer and new071000 invoice original/receipt; new071500 exact classes/current own policy/separate review/hash/replay/receiptNULL/restore denial',authority:'Explicit synthetic auth/schema/competence plus unapproved invoice capture boundary; NOT native Supabase, Storage, browser, real legal authority or whole DB05',invoicePredecessorSha256:createHash('sha256').update(readFileSync(invoice)).digest('hex'),newMigrationSha256:createHash('sha256').update(readFileSync(new URL('20261001071500_ediel_customer_invoice_retention_decision_original_classes.sql',own))).digest('hex')}))
}
}finally{await db.close()}
`
try{await import('data:text/javascript;base64,'+Buffer.from(base+phase).toString('base64'))}catch(error){console.error(JSON.stringify({status:'FAIL',name:error.name,code:error.code,message:error.message,detail:error.detail}));process.exitCode=1}
