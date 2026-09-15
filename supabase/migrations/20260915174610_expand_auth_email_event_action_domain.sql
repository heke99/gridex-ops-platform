-- Staged forward candidate; not yet a selected migration or schema acceptance.
-- Preserve the seven CHECK values restored by the approved legacy boundary.
-- Add only the four values authored by the May20 direct-password/auth source.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $auth_email_action_domain$
declare
  relation_oid oid;
  action_number smallint;
  check_oid oid;
  actual_definition text;
  old_definition constant text := $old$CHECK (action = ANY (ARRAY['invite_sent'::text, 'password_reset_sent'::text, 'confirmation_sent'::text, 'email_confirmed'::text, 'password_updated'::text, 'auth_callback_completed'::text, 'auth_callback_failed'::text]))$old$;
  new_definition constant text := $new$CHECK (action = ANY (ARRAY['invite_sent'::text, 'password_reset_sent'::text, 'confirmation_sent'::text, 'email_confirmed'::text, 'password_updated'::text, 'auth_callback_completed'::text, 'auth_callback_failed'::text, 'email_action_verified'::text, 'company_invitation_accepted'::text, 'direct_user_created'::text, 'direct_user_linked'::text]))$new$;
begin
  select c.oid into relation_oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='auth_email_events' and c.relkind='r';
  if relation_oid is null then
    raise exception using errcode='55000',message='AUTH_EMAIL_ACTION_RELATION_REQUIRED';
  end if;
  lock table only public.auth_email_events in access exclusive mode;
  if relation_oid is distinct from to_regclass('public.auth_email_events')
     or not exists(select 1 from pg_class where oid=relation_oid and relkind='r'
                   and relrowsecurity and not relforcerowsecurity)
     or exists(select 1 from pg_inherits where inhrelid=relation_oid or inhparent=relation_oid) then
    raise exception using errcode='55000',message='AUTH_EMAIL_ACTION_SHAPE_REQUIRED';
  end if;
  select a.attnum into action_number from pg_attribute a
    where a.attrelid=relation_oid and a.attname='action' and not a.attisdropped
      and a.atttypid='text'::regtype and a.atttypmod=-1 and a.attnotnull
      and a.attidentity='' and a.attgenerated=''
      and a.attcollation=(select typcollation from pg_type where oid='text'::regtype)
      and not exists(select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum);
  if action_number is null then
    raise exception using errcode='55000',message='AUTH_EMAIL_ACTION_COLUMN_REQUIRED';
  end if;
  select c.oid,pg_get_constraintdef(c.oid,true) into check_oid,actual_definition
    from pg_constraint c where c.conrelid=relation_oid
      and c.conname='auth_email_events_action_check' and c.contype='c' and c.convalidated
      and c.conislocal and c.coninhcount=0 and not c.connoinherit
      and c.conkey=array[action_number] and obj_description(c.oid,'pg_constraint') is null;
  if check_oid is null or actual_definition not in (old_definition,new_definition)
     or (select count(*) from pg_constraint where conrelid=relation_oid and contype='c'
         and action_number=any(conkey))<>1 then
    raise exception using errcode='55000',message='AUTH_EMAIL_ACTION_DOMAIN_REQUIRED';
  end if;
  if actual_definition=old_definition then
    alter table only public.auth_email_events drop constraint auth_email_events_action_check;
    alter table only public.auth_email_events add constraint auth_email_events_action_check
      check(action in ('invite_sent','password_reset_sent','confirmation_sent','email_confirmed',
        'password_updated','auth_callback_completed','auth_callback_failed','email_action_verified',
        'company_invitation_accepted','direct_user_created','direct_user_linked'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid=relation_oid
      and conname='auth_email_events_action_check' and contype='c' and convalidated
      and pg_get_constraintdef(oid,true)=new_definition) then
    raise exception using errcode='55000',message='AUTH_EMAIL_ACTION_POSTCONDITION_REQUIRED';
  end if;
end $auth_email_action_domain$;
commit;
