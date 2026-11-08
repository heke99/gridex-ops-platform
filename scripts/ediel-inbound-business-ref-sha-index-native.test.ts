// Track 3 finding 016: same business reference with changed content must be
// storable; identical content stays deduplicated; tenant scope and Message-ID
// uniqueness are unchanged. Everything runs in ONE transaction that is rolled
// back, with migration 20261030131000 applied inside it.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {expect,it} from 'vitest'

const MIGRATION=resolve(__dirname,'../supabase/migrations/20261030131000_inbound_email_business_ref_unique_includes_sha.sql')

type Outcome={changedContentInterchange:string;changedContentTxExternal:string;sameShaInterchange:string;sameShaTxExternal:string;otherTenantSameSha:string;messageIdDuplicate:string;nullShaSameRef:string}

function probe(applyMigration:boolean):Outcome {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const migration=applyMigration?readFileSync(MIGRATION,'utf8'):''
 const script=`begin;
${migration}
create temp table t016_out(k text primary key, v text) on commit drop;
do $t016$
declare
 c1 uuid; c2 uuid; ref text := 'T016-'||gen_random_uuid(); r text;
 procedure_ok boolean;
begin
 select id into c1 from public.companies order by id limit 1;
 select id into c2 from public.companies where id<>c1 order by id limit 1;
 if c1 is null or c2 is null then raise exception 't016_two_companies_required'; end if;

 -- baseline rows: sha A for both reference shapes
 insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference,raw_message_sha256,internet_message_id)
   values (c1,'test','T016SENDER',ref,'sha-a','<'||ref||'-1@t016>');
 insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,transaction_reference,external_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref,ref||'-x','sha-a');

 begin insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref,'sha-b'); r:='inserted';
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('changedContentInterchange',r);

 begin insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,transaction_reference,external_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref,ref||'-x','sha-b'); r:='inserted';
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('changedContentTxExternal',r);

 begin insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref,'sha-a'); r:='inserted';
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('sameShaInterchange',r);

 begin insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,transaction_reference,external_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref,ref||'-x','sha-a'); r:='inserted';
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('sameShaTxExternal',r);

 begin insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference,raw_message_sha256)
   values (c2,'test','T016SENDER',ref,'sha-a'); r:='inserted';
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('otherTenantSameSha',r);

 insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref||'-n',null);
 begin insert into public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference,raw_message_sha256)
   values (c1,'test','T016SENDER',ref||'-n',null); r:='inserted';
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('nullShaSameRef',r);

 -- Message-ID uniqueness per mailbox (needs a mailbox row)
 begin
  insert into public.inbound_email_messages(company_id,mailbox_id,internet_message_id,raw_message_sha256)
   select c1, m.id, '<'||ref||'-mid@t016>', 'sha-m1' from public.ediel_mailboxes m limit 1;
  insert into public.inbound_email_messages(company_id,mailbox_id,internet_message_id,raw_message_sha256)
   select c1, m.id, '<'||ref||'-mid@t016>', 'sha-m2' from public.ediel_mailboxes m limit 1;
  r:= case when exists(select 1 from public.ediel_mailboxes) then 'inserted' else 'no_mailbox' end;
 exception when unique_violation then r:='unique_violation'; end;
 insert into t016_out values('messageIdDuplicate',r);
end $t016$;
select json_object_agg(k,v) from t016_out;
rollback;`
 const out=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{input:script,encoding:'utf8',timeout:60000}).trim()
 const line=out.split('\n').map(l=>l.trim()).find(l=>l.startsWith('{'))
 if(!line)throw Error('t016_no_result:'+out)
 return JSON.parse(line) as Outcome
}

it('same reference with changed content is storable; same content, NULL hash and Message-ID stay unique; other tenant allowed',()=>{
 const o=probe(process.env.T016_SKIP_MIGRATION!=='1')
 expect(o.changedContentInterchange).toBe('inserted')
 expect(o.changedContentTxExternal).toBe('inserted')
 expect(o.sameShaInterchange).toBe('unique_violation')
 expect(o.sameShaTxExternal).toBe('unique_violation')
 expect(o.nullShaSameRef).toBe('unique_violation')
 expect(o.otherTenantSameSha).toBe('inserted')
 expect(o.messageIdDuplicate).toBe('unique_violation')
})
