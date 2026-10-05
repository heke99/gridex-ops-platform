// Bounded actual PostgreSQL trigger identity/mutation checks, not native replay.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
try{
 await db.exec("CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.sources(id int PRIMARY KEY,payload text);CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'received_source_evidence_is_append_only' USING ERRCODE='23514';END$$;CREATE TRIGGER received_sources_no_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.sources FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();INSERT INTO gridex_received_sources.sources VALUES(1,'IMMUTABLE ORIGINAL');")
 const before=(await db.query("SELECT to_jsonb(t) record FROM pg_trigger t WHERE tgrelid='gridex_received_sources.sources'::regclass AND tgname='received_sources_no_update_delete'")).rows[0].record
 await assert.rejects(()=>db.exec('DROP TRIGGER no_evidence_update_delete ON gridex_received_sources.sources'),/does not exist/)
 for(const sql of ["UPDATE gridex_received_sources.sources SET payload='CHANGED' WHERE id=1",'DELETE FROM gridex_received_sources.sources WHERE id=1'])await assert.rejects(()=>db.exec(sql),/append_only/)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000699_ediel_retention_source_trigger_prerequisite.sql',import.meta.url),'utf8'))
 const after=(await db.query("SELECT to_jsonb(t) record FROM pg_trigger t WHERE oid=$1",[before.oid])).rows[0].record
 assert.deepEqual({...after,tgname:before.tgname},before)
 assert.equal(after.tgname,'no_evidence_update_delete')
 for(const sql of ["UPDATE gridex_received_sources.sources SET payload='CHANGED' WHERE id=1",'DELETE FROM gridex_received_sources.sources WHERE id=1'])await assert.rejects(()=>db.exec(sql),/append_only/)
 await db.exec('DROP TRIGGER no_evidence_update_delete ON gridex_received_sources.sources')
 console.log('PASS missing historical target red, exact OID/function/event/enabled-mode rename green, immutable UPDATE/DELETE still denied before/after, unchanged00700 DROP name compatible (bounded SQL only)')
}finally{await db.close()}
