// Declared embedded PostgreSQL mechanics. This is not native replay, market
// data, legal approval, RLS certification or authentic original evidence.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
if (!process.env.EDIEL_PGLITE_MODULE) throw new Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks = 0
const expectFailure = async (sql, pattern) => { await assert.rejects(db.exec(sql), pattern); checks++ }
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA gridex_received_sources;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_standard text,message_code text,message_received_at timestamptz,raw_payload text,immutable_payload_hash text,execution_context_snapshot jsonb);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid NOT NULL,environment text NOT NULL,origin text,message_code text,source_received_at timestamptz,captured_at timestamptz,raw_payload text,payload_hash text,received_context jsonb);
 INSERT INTO public.ediel_messages VALUES('${uid(1)}','${uid(2)}','test','inbound','UTILTS','edifact','E66','2026-09-29 12:00+00','HISTORICAL SYNTHETIC SOURCE',NULL,'{}');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930183539_ediel_received_utilts_source_ledger.sql',import.meta.url),'utf8')); checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.sources')).rows[0].n,0); checks++
 await expectFailure(`UPDATE public.ediel_messages SET execution_context_snapshot='{"receivedUtiltsContext":{"version":1}}' WHERE id='${uid(1)}'`,/cannot_be_backfilled/)
 await db.exec(`INSERT INTO public.ediel_messages VALUES('${uid(3)}','${uid(2)}','test','inbound','UTILTS','edifact','E66','2026-09-30 12:00+00','DECLARED SYNTHETIC UTILTS ORIGINAL','FORGED','{"receivedUtiltsContext":{"contextOrigin":"forged"},"unrelated":"retained"}')`)
 const captured=(await db.query(`SELECT * FROM gridex_received_sources.sources WHERE source_message_id='${uid(3)}'`)).rows[0]
 const hash=createHash('sha256').update('DECLARED SYNTHETIC UTILTS ORIGINAL').digest('hex')
 assert.equal(captured.payload_hash,hash);assert.equal(captured.received_context.contextOrigin,'database_insert');assert.equal(captured.received_context.companyId,uid(2));checks++
 assert.deepEqual(Object.keys(captured.received_context).sort(),['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt'].sort());checks++
 assert.equal((await db.query(`SELECT captured_at=(received_context->>'capturedAt')::timestamptz same_clock FROM gridex_received_sources.sources WHERE source_message_id='${uid(3)}'`)).rows[0].same_clock,true);checks++
 await expectFailure(`UPDATE public.ediel_messages SET raw_payload='DIFFERENT' WHERE id='${uid(3)}'`,/immutable_received_utilts/)
 await expectFailure(`UPDATE public.ediel_messages SET company_id='${uid(9)}' WHERE id='${uid(3)}'`,/immutable_received_utilts/)
 await expectFailure(`UPDATE public.ediel_messages SET environment='production' WHERE id='${uid(3)}'`,/immutable_received_utilts/)
 await expectFailure(`UPDATE public.ediel_messages SET execution_context_snapshot=execution_context_snapshot-'receivedUtiltsContext' WHERE id='${uid(3)}'`,/immutable_received_utilts/)
 await db.exec(`UPDATE public.ediel_messages SET execution_context_snapshot=execution_context_snapshot||'{"mutableProjection":"changed"}' WHERE id='${uid(3)}'`)
 assert.deepEqual((await db.query(`SELECT * FROM gridex_received_sources.sources WHERE source_message_id='${uid(3)}'`)).rows[0],captured);checks++
 await db.exec(`INSERT INTO public.ediel_messages VALUES('${uid(4)}','${uid(2)}','test','outbound','UTILTS','edifact','E73',now(),'SYNTHETIC OUTBOUND',NULL,'{}')`)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.sources')).rows[0].n,1);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('service_role','gridex_received_sources.capture_utilts_insert_v1()','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} targeted prospective UTILTS original-capture PostgreSQL checks; native replay and RLS proof pending`)
} finally { await db.close() }
