-- gridex_ediel_transport.dsn_sending_mailbox_v1(c,env,smtp_from) compares the
-- observed SMTP sender with public.ediel_mailboxes.email_address. The table
-- also has a smtp_from column (20260602101500), so the unqualified reference
-- raised "column reference smtp_from is ambiguous" on every call and blocked
-- every DSN/send-path mailbox resolution.
--
-- Qualify the parameter so the comparison keeps its intended meaning
-- (observed sender against the mailbox address). Signature, security,
-- configuration and ACL are unchanged.
BEGIN;
DO $rewrite$DECLARE f record;
 needle CONSTANT text:='AND lower(email_address)=lower(smtp_from) AND';
 replacement CONSTANT text:='AND lower(email_address)=lower(dsn_sending_mailbox_v1.smtp_from) AND';
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_transport.dsn_sending_mailbox_v1(uuid,text,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'dsn_sending_mailbox_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'dsn_sending_mailbox_metadata_changed';END IF;
END$rewrite$;
COMMIT;
