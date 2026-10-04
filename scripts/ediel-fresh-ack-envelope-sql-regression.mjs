// Focused real lexer/new birth guard mechanics. The delegated canonical owner
// is an explicit boundary fixture; this is not a native clean replay proof.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite();let checks=0
const raw="UNB+UNOC:3+LOCAL:14+REMOTE:14+261001:1200+OWN?+I++23-DDQ-E66-T++++1'UNH+OWN?:M+APERAK:D:04A:UN:E5SE5A'BGM+313+D+9'UNT+3+OWN?:M'UNZ+1+OWN?+I'"
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_outbound_owner;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,direction text,message_family text,raw_payload text,status text);
 CREATE TABLE gridex_ediel_outbound_owner.delegated_prepares(id integer GENERATED ALWAYS AS IDENTITY,raw_payload text);
 CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO gridex_ediel_outbound_owner.delegated_prepares(raw_payload)VALUES(i->>'rawPayload');RETURN jsonb_build_object('boundary','actual_canonical_owner_separately_tested');END$$;`)
 const inherited=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 // A fixed old original exists before this prospective birth guard. Its raw
 // bytes remain available without a new current-envelope acceptance claim.
 const oldRaw=raw.replace('UNZ+1+OWN?+I','UNZ+1+OLD-MISMATCH')
 await db.query("INSERT INTO ediel_messages VALUES($1,'outbound','APERAK',$2,'failed')",[uid(1),oldRaw])
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001021545_ediel_fresh_ack_native_envelope_authority.sql',import.meta.url),'utf8'));checks++
 const require=async(wire=raw,family='APERAK')=>db.query('SELECT gridex_ediel_ack_guide.require_fresh_ack_envelope_v1($1,$2)',[wire,family])
 const prepare=async wire=>db.query('SELECT gridex_ediel_outbound_owner.prepare_v1($1)',[{rawPayload:wire}])
 await require();checks++
 // Same state machine decodes released separators exactly once, including
 // alternate UNA. Counts/references are decoded values, never string splits.
 const alternate="UNA;*.! ~UNB*UNOC;3*LOCAL;14*REMOTE;14*261001;1200*OWN!+I**23-DDQ-E66-T****1~UNH*OWN!;M*APERAK;D;04A;UN;E5SE5A~BGM*313*D*9~UNT*3*OWN!;M~UNZ*1*OWN!+I~"
 await require(alternate);checks++
 await require(raw.replace('UNZ+1+','UNZ+0001+').replace('UNT+3+','UNT+0003+'));checks++
 const bad=[raw.replace('UNZ+1+OWN?+I','UNZ+1+OTHER'),raw.replace('UNZ+1+OWN?+I','UNZ+1+'),
  raw.replace('UNZ+1+','UNZ+0+'),raw.replace('UNZ+1+','UNZ+2+'),raw.replace('UNZ+1+','UNZ+-1+'),raw.replace('UNZ+1+','UNZ+1:1+'),
  raw.replace('UNT+3+','UNT+2+'),raw.replace('UNT+3+','UNT+0+'),raw.replace('UNT+3+','UNT+X+'),raw.replace('UNT+3+','UNT+3:3+'),
  raw.replace('UNT+3+OWN?:M','UNT+3+OTHER'),raw.replace('UNT+3+OWN?:M','UNT+3+'),
  raw.replace('UNH+OWN?:M','UNH+OWN:M'),raw.replace('UNZ+1+OWN?+I','UNZ+1+OWN+I'),
  raw.replace("'UNH+","'FTX+AAO+++OUTSIDE'UNH+"),raw.replace("'UNZ+","'FTX+AAO+++OUTSIDE'UNZ+"),
  raw+"FTX+AAO+++AFTER'",raw.replace('UNZ+1+','UNZ+9007199254740992+'),
  raw.replace("UNZ+1+OWN?+I'",''),raw+"UNZ+1+OWN?+I'",raw.replace("BGM+313+D+9'","UNB+UNOC:3+X+Y+D+X'"),
  raw.replace("BGM+313+D+9'","UNH+OTHER+APERAK:D:04A:UN:E5SE5A'"),raw.replace("BGM+313+D+9'","UNT+1+OWN?:M'"),
  raw.replace("BGM+313+D+9'","BGM+313+D+9?")]
 for(const wire of bad){await assert.rejects(require(wire),/ediel_fresh_ack_envelope_invalid/);checks++}
 const before=(await db.query('SELECT count(*)::int n FROM gridex_ediel_outbound_owner.delegated_prepares')).rows[0].n
 await assert.rejects(prepare(bad[0]),/ediel_fresh_ack_envelope_invalid/)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_ediel_outbound_owner.delegated_prepares')).rows[0].n,before);checks++
 await prepare(raw);checks++
 await db.query("INSERT INTO ediel_messages VALUES($1,'outbound','APERAK',$2,'prepared')",[uid(2),raw]);checks++
 // Physical ACK classification also protects a mislabeled new row.
 await assert.rejects(db.query("INSERT INTO ediel_messages VALUES($1,'outbound','OTHER',$2,'prepared')",[uid(3),bad[0]]),/ediel_fresh_ack_envelope_invalid/);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM ediel_messages WHERE id=$1',[uid(3)])).rows[0].n,0);checks++
 await db.query("INSERT INTO ediel_messages VALUES($1,'outbound','APERAK',NULL,'draft')",[uid(4)])
 await assert.rejects(db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[bad[0],uid(4)]),/ediel_fresh_ack_envelope_invalid/)
 assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[uid(4)])).rows[0].raw_payload,null);checks++
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[raw,uid(4)]);checks++
 await db.query("UPDATE ediel_messages SET status='prepared',raw_payload=raw_payload WHERE id=$1",[uid(1)])
 assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[uid(1)])).rows[0].raw_payload,oldRaw);checks++
 await require(raw.replace('APERAK:D:04A:UN:E5SE5A','CONTRL:2:1:UN'));checks++
 await require(raw.replace('APERAK:D:04A:UN:E5SE5A','UTILTS:D:04A:UN:E5SE5A').replace('BGM+313','BGM+ERR'),'UTILTS_ERR');checks++
 // Ordinary message batching is a different national/profile decision, not a
 // new ACK birth constraint. This helper must not outlaw its multi-UNH wire.
 const ordinary="UNB+UNOC:3+LOCAL+REMOTE+D+I'UNH+M1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03'UNT+3+M1'UNH+M2+PRODAT:D:97A:UN:E2SE6A'BGM+Z03'UNT+3+M2'UNZ+2+I'"
 await require(ordinary,'PRODAT');checks++
 const acl=(await db.query("SELECT has_function_privilege('service_role','gridex_ediel_outbound_owner.prepare_v1(jsonb)','execute') prepare,has_function_privilege('service_role','gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(text,text)','execute') direct_guard,has_function_privilege('authenticated','gridex_ediel_outbound_owner.prepare_v1(jsonb)','execute') client_prepare")).rows[0]
 assert.deepEqual(acl,{prepare:true,direct_guard:false,client_prepare:false});checks++
 console.log(`Focused fresh native ACK envelope/owner delegation/atomic birth/historical retention checks: ${checks} PASS`)
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1}finally{await db.close()}
