-- Converge the authentic auth-template two-column index to the SaaS/live shape.
-- Only the exact recognized predecessor may be replaced. Never trust a name alone.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.company_invitations in access exclusive mode;
do $$
declare
  index_oid oid := to_regclass('public.company_invitations_company_status_idx');
  definition text;
  old_definition constant text := 'CREATE INDEX company_invitations_company_status_idx ON public.company_invitations USING btree (company_id, status)';
  intended_definition constant text := 'CREATE INDEX company_invitations_company_status_idx ON public.company_invitations USING btree (company_id, status, created_at DESC)';
begin
  if index_oid is not null then
    select pg_catalog.pg_get_indexdef(i.indexrelid) into definition
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid=i.indexrelid
    join pg_catalog.pg_am am on am.oid=c.relam
    where i.indexrelid=index_oid and i.indrelid='public.company_invitations'::regclass
      and c.relkind='i' and am.amname='btree'
      and not i.indisunique and not i.indisprimary and i.indisvalid and i.indisready
      and i.indnatts=i.indnkeyatts and i.indnkeyatts in (2,3)
      and i.indpred is null and i.indexprs is null
      and not exists(select 1 from pg_catalog.pg_constraint where conindid=index_oid);
    if definition is null or definition not in (old_definition,intended_definition) then
      raise exception 'Conflicting company_invitations_company_status_idx definition' using errcode='23514';
    end if;
    if definition=intended_definition then
      return;
    end if;
    -- The enclosing transaction makes replacement atomic; failure restores the
    -- original index. No tenant/invitation rows or unrelated indexes are changed.
    drop index public.company_invitations_company_status_idx;
  end if;
  create index company_invitations_company_status_idx
    on public.company_invitations using btree (company_id,status,created_at desc);
end;
$$;
commit;
