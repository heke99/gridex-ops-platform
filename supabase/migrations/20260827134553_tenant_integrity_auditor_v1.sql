begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.tenant_integrity_rule_registry (
  rule_key text primary key,
  category text not null,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  enforcement_mode text not null default 'audit' check (enforcement_mode in ('database','audit','release_gate')),
  title text not null,
  description text not null,
  remediation_hint text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_integrity_audit_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  scope text not null default 'all' check (scope in ('all','access','operations','ediel')),
  status text not null default 'running' check (status in ('running','completed','failed')),
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  finding_count integer not null default 0,
  critical_count integer not null default 0,
  high_count integer not null default 0,
  medium_count integer not null default 0,
  low_count integer not null default 0,
  info_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.tenant_integrity_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.tenant_integrity_audit_runs(id) on delete cascade,
  rule_key text not null references public.tenant_integrity_rule_registry(rule_key) on delete restrict,
  company_id uuid references public.companies(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  title text not null,
  message text not null,
  fingerprint text not null,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  unique(run_id, fingerprint)
);

create index if not exists tenant_integrity_runs_company_started_idx
  on public.tenant_integrity_audit_runs(company_id, started_at desc);
create index if not exists tenant_integrity_runs_status_started_idx
  on public.tenant_integrity_audit_runs(status, started_at desc);
create index if not exists tenant_integrity_findings_run_severity_idx
  on public.tenant_integrity_findings(run_id, severity);
create index if not exists tenant_integrity_findings_company_rule_idx
  on public.tenant_integrity_findings(company_id, rule_key, detected_at desc);
create index if not exists tenant_integrity_findings_fingerprint_idx
  on public.tenant_integrity_findings(fingerprint, detected_at desc);

insert into public.tenant_integrity_rule_registry
  (rule_key, category, severity, enforcement_mode, title, description, remediation_hint, is_enabled)
values
  ('TENANT-001','tenant','high','release_gate','Tenant lifecycle flags disagree','Canonical tenant status, is_active and is_paused must not contradict each other.','Use the canonical tenant lifecycle command; do not patch status flags independently.',true),
  ('ACCESS-001','access','critical','release_gate','Active membership has inactive profile','An active tenant membership must resolve to an active user profile.','Repair the user lifecycle through the canonical access command and verify Auth/profile state.',true),
  ('ACCESS-002','access','high','release_gate','Membership role mapping drift','Active membership_role must match the canonical mapping for role_key.','Reconcile through canonical_change_tenant_user_access; do not edit only one role field.',true),
  ('ACCESS-003','access','critical','release_gate','Active membership lacks matching RBAC role','Every active tenant membership must have one matching active company-scoped RBAC role.','Re-run canonical access provisioning and verify company-scoped user_roles.',true),
  ('ACCESS-004','access','high','audit','Active company selection is not accessible','A user profile active_company_id must point to a tenant where the user has an active membership.','Clear or change active_company_id through the canonical tenant selection flow.',true),
  ('ACCESS-005','access','high','audit','Accepted invitation lacks membership','An accepted invitation with an invited user must have a membership row for the same tenant and user.','Reconcile the invitation through canonical acceptance/provisioning; preserve invitation history.',true),
  ('OPS-001','operations','critical','release_gate','Core customer graph crosses tenant boundary','Customer, site, metering point, contract and supplier switch references must resolve to one tenant.','Stop the workflow and repair the parent relation using tenant-qualified canonical IDs.',true),
  ('OUTBOUND-001','operations','critical','release_gate','Outbound request crosses tenant boundary','Outbound request tenant must match its customer, site, metering point, switch and contract relations.','Block dispatch and rebuild the outbound request from the canonical customer operation.',true),
  ('EDIEL-001','ediel','critical','release_gate','Outbound Ediel graph crosses tenant boundary','A non-draft outbound Ediel message must use one tenant across all linked business entities.','Block sending and rebuild message/routing context from the canonical tenant operation.',true),
  ('EDIEL-002','ediel','high','release_gate','Resolved Ediel tenant disagrees with message tenant','resolved_company_id and company_id may not disagree once both are known.','Quarantine the message and rerun canonical tenant resolution before business processing.',true),
  ('EDIEL-003','ediel','critical','release_gate','Ediel outbox tenant disagrees with message tenant','Sendable Ediel outbox rows must have the same tenant as their Ediel message.','Block the outbox row and rematerialize it from the canonical message.',true),
  ('EDIEL-004','ediel','critical','release_gate','Blocked tenant still has sendable production Ediel','Paused, suspended, frozen or Ediel-blocked tenants must not retain prepared/queued/sending production outbox work.','Move work to blocked_tenant_state and require explicit canonical resume/re-evaluation.',true),
  ('EDIEL-005','ediel','high','release_gate','Live Ediel tenant lacks active production actor','A tenant with production Ediel enabled must have an active, currently valid production actor setting.','Complete/activate the production actor profile before enabling production Ediel.',true),
  ('EDIEL-006','ediel','high','audit','Overlapping active tenant Ediel profiles','A tenant/environment/market must not have more than one currently active tenant Ediel profile.','Close the superseded validity interval and keep one effective profile.',true)
on conflict(rule_key) do update set
  category=excluded.category,
  severity=excluded.severity,
  enforcement_mode=excluded.enforcement_mode,
  title=excluded.title,
  description=excluded.description,
  remediation_hint=excluded.remediation_hint,
  is_enabled=excluded.is_enabled,
  updated_at=now();

alter table public.tenant_integrity_rule_registry enable row level security;
alter table public.tenant_integrity_rule_registry force row level security;
alter table public.tenant_integrity_audit_runs enable row level security;
alter table public.tenant_integrity_audit_runs force row level security;
alter table public.tenant_integrity_findings enable row level security;
alter table public.tenant_integrity_findings force row level security;

drop policy if exists tenant_integrity_rule_registry_service_role_all on public.tenant_integrity_rule_registry;
create policy tenant_integrity_rule_registry_service_role_all
on public.tenant_integrity_rule_registry for all to service_role using (true) with check (true);
drop policy if exists tenant_integrity_audit_runs_service_role_all on public.tenant_integrity_audit_runs;
create policy tenant_integrity_audit_runs_service_role_all
on public.tenant_integrity_audit_runs for all to service_role using (true) with check (true);
drop policy if exists tenant_integrity_findings_service_role_all on public.tenant_integrity_findings;
create policy tenant_integrity_findings_service_role_all
on public.tenant_integrity_findings for all to service_role using (true) with check (true);

revoke all on public.tenant_integrity_rule_registry from public, anon, authenticated;
revoke all on public.tenant_integrity_audit_runs from public, anon, authenticated;
revoke all on public.tenant_integrity_findings from public, anon, authenticated;
grant select on public.tenant_integrity_rule_registry to service_role;
grant select,insert,update on public.tenant_integrity_audit_runs to service_role;
grant select,insert,update,delete on public.tenant_integrity_findings to service_role;

create or replace function public.run_tenant_integrity_audit(
  p_company_id uuid default null,
  p_scope text default 'all',
  p_requested_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_run_id uuid;
  v_scope text := lower(coalesce(nullif(btrim(p_scope),''),'all'));
  v_total integer := 0;
  v_critical integer := 0;
  v_high integer := 0;
  v_medium integer := 0;
  v_low integer := 0;
  v_info integer := 0;
begin
  if v_scope not in ('all','access','operations','ediel') then
    raise exception using errcode='22023', message='tenant_integrity_invalid_scope';
  end if;
  if p_company_id is not null and not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception using errcode='P0002', message='tenant_integrity_company_not_found';
  end if;

  insert into public.tenant_integrity_audit_runs(company_id,scope,requested_by,status,metadata)
  values(p_company_id,v_scope,p_requested_by,'running',jsonb_build_object('engine_version','v1'))
  returning id into v_run_id;

  begin
    if v_scope in ('all','operations') then
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'TENANT-001',c.id,'company',c.id,r.severity,r.title,
             'Tenant lifecycle/status flags contradict the canonical tenant state.',
             md5('TENANT-001:'||c.id::text),
             jsonb_build_object('status',c.status,'is_active',c.is_active,'is_paused',c.is_paused,'lifecycle_status',c.lifecycle_status,'outbound_frozen',c.outbound_frozen)
      from public.companies c
      join public.tenant_integrity_rule_registry r on r.rule_key='TENANT-001' and r.is_enabled
      where (p_company_id is null or c.id=p_company_id)
        and (
          (c.status='paused' and coalesce(c.is_paused,false)=false)
          or (coalesce(c.is_paused,false)=true and c.status<>'paused')
          or (c.status in ('suspended','archived','pending_deletion','closed','deleted_test_only') and coalesce(c.is_active,false)=true)
        );

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'OPS-001',x.company_id,x.entity_type,x.entity_id,r.severity,r.title,
             x.message,md5('OPS-001:'||x.entity_type||':'||x.entity_id::text),x.evidence
      from (
        select coalesce(s.company_id,c.company_id) company_id,'customer_site'::text entity_type,s.id entity_id,
               'Customer site tenant differs from its customer tenant.'::text message,
               jsonb_build_object('site_company_id',s.company_id,'customer_company_id',c.company_id,'customer_id',c.id) evidence
        from public.customer_sites s join public.customers c on c.id=s.customer_id
        where s.company_id is distinct from c.company_id
          and (p_company_id is null or s.company_id=p_company_id or c.company_id=p_company_id)
        union all
        select coalesce(mp.company_id,s.company_id,c.company_id),'metering_point',mp.id,
               'Metering point relation disagrees with customer/site tenant or customer identity.',
               jsonb_build_object('meter_company_id',mp.company_id,'site_company_id',s.company_id,'customer_company_id',c.company_id,'meter_customer_id',mp.customer_id,'site_customer_id',s.customer_id,'site_id',s.id)
        from public.metering_points mp
        join public.customer_sites s on s.id=mp.site_id
        join public.customers c on c.id=s.customer_id
        where (mp.company_id is distinct from s.company_id or s.company_id is distinct from c.company_id or (mp.customer_id is not null and mp.customer_id is distinct from s.customer_id))
          and (p_company_id is null or mp.company_id=p_company_id or s.company_id=p_company_id or c.company_id=p_company_id)
        union all
        select coalesce(cc.company_id,c.company_id),'customer_contract',cc.id,
               'Customer contract relation disagrees with customer/site/metering point tenant.',
               jsonb_build_object('contract_company_id',cc.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'customer_id',cc.customer_id,'site_id',coalesce(cc.customer_site_id,cc.site_id),'metering_point_id',cc.metering_point_id)
        from public.customer_contracts cc
        join public.customers c on c.id=cc.customer_id
        left join public.customer_sites s on s.id=coalesce(cc.customer_site_id,cc.site_id)
        left join public.metering_points mp on mp.id=cc.metering_point_id
        where (cc.company_id is distinct from c.company_id or (s.id is not null and cc.company_id is distinct from s.company_id) or (mp.id is not null and cc.company_id is distinct from mp.company_id))
          and (p_company_id is null or cc.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id)
        union all
        select coalesce(sw.company_id,c.company_id),'supplier_switch_request',sw.id,
               'Supplier switch relation disagrees with customer/site/metering point/contract tenant.',
               jsonb_build_object('switch_company_id',sw.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'contract_company_id',cc.company_id,'customer_id',sw.customer_id,'site_id',sw.site_id,'metering_point_id',sw.metering_point_id)
        from public.supplier_switch_requests sw
        join public.customers c on c.id=sw.customer_id
        join public.customer_sites s on s.id=sw.site_id
        join public.metering_points mp on mp.id=sw.metering_point_id
        left join public.customer_contracts cc on cc.id=coalesce(sw.customer_contract_id,sw.contract_id)
        where (sw.company_id is distinct from c.company_id or sw.company_id is distinct from s.company_id or sw.company_id is distinct from mp.company_id or (cc.id is not null and sw.company_id is distinct from cc.company_id) or s.customer_id is distinct from sw.customer_id or (mp.customer_id is not null and mp.customer_id is distinct from sw.customer_id))
          and (p_company_id is null or sw.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or cc.company_id=p_company_id)
      ) x
      join public.tenant_integrity_rule_registry r on r.rule_key='OPS-001' and r.is_enabled;

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'OUTBOUND-001',coalesce(o.company_id,c.company_id), 'outbound_request',o.id,r.severity,r.title,
             'Outbound request tenant disagrees with one or more linked business entities.',
             md5('OUTBOUND-001:'||o.id::text),
             jsonb_build_object('outbound_company_id',o.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'switch_company_id',sw.company_id,'contract_company_id',cc.company_id,'customer_id',o.customer_id,'site_id',coalesce(o.customer_site_id,o.site_id),'metering_point_id',o.metering_point_id)
      from public.outbound_requests o
      join public.customers c on c.id=o.customer_id
      left join public.customer_sites s on s.id=coalesce(o.customer_site_id,o.site_id)
      left join public.metering_points mp on mp.id=o.metering_point_id
      left join public.supplier_switch_requests sw on sw.id=coalesce(o.supplier_switch_request_id,o.switch_request_id)
      left join public.customer_contracts cc on cc.id=coalesce(o.customer_contract_id,o.contract_id)
      join public.tenant_integrity_rule_registry r on r.rule_key='OUTBOUND-001' and r.is_enabled
      where (
          o.company_id is distinct from c.company_id
          or (s.id is not null and o.company_id is distinct from s.company_id)
          or (mp.id is not null and o.company_id is distinct from mp.company_id)
          or (sw.id is not null and o.company_id is distinct from sw.company_id)
          or (cc.id is not null and o.company_id is distinct from cc.company_id)
          or (o.customer_site_id is not null and o.site_id is not null and o.customer_site_id<>o.site_id)
        )
        and (p_company_id is null or o.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or sw.company_id=p_company_id or cc.company_id=p_company_id);
    end if;

    if v_scope in ('all','access') then
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-001',cm.company_id,'company_membership',cm.id,r.severity,r.title,
             'Active membership does not resolve to an active user profile.',md5('ACCESS-001:'||cm.id::text),
             jsonb_build_object('user_id',cm.user_id,'membership_status',cm.status,'membership_is_active',cm.is_active,'profile_status',up.user_status)
      from public.company_memberships cm
      left join public.user_profiles up on up.id=cm.user_id
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-001' and r.is_enabled
      where cm.status='active' and coalesce(cm.is_active,true)=true
        and (up.id is null or up.user_status<>'active')
        and (p_company_id is null or cm.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-002',cm.company_id,'company_membership',cm.id,r.severity,r.title,
             'membership_role does not match canonical role_key mapping.',md5('ACCESS-002:'||cm.id::text),
             jsonb_build_object('user_id',cm.user_id,'role_key',cm.role_key,'membership_role',cm.membership_role,'expected_membership_role',m.membership_role)
      from public.company_memberships cm
      left join public.canonical_tenant_access_role_mapping m on m.role_key=lower(cm.role_key)
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-002' and r.is_enabled
      where cm.status='active' and coalesce(cm.is_active,true)=true
        and (cm.role_key is null or m.role_key is null or lower(cm.membership_role)<>lower(m.membership_role))
        and (p_company_id is null or cm.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-003',cm.company_id,'company_membership',cm.id,r.severity,r.title,
             'Active membership lacks a matching active tenant RBAC role.',md5('ACCESS-003:'||cm.id::text),
             jsonb_build_object('user_id',cm.user_id,'role_key',cm.role_key,'membership_role',cm.membership_role)
      from public.company_memberships cm
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-003' and r.is_enabled
      where cm.status='active' and coalesce(cm.is_active,true)=true
        and not exists (
          select 1 from public.user_roles ur
          join public.roles rr on rr.id=ur.role_id
          where ur.company_id=cm.company_id and ur.user_id=cm.user_id
            and ur.status='active' and coalesce(ur.is_active,true)=true
            and lower(coalesce(rr.key,rr.name,ur.role,''))=lower(coalesce(cm.role_key,''))
        )
        and (p_company_id is null or cm.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-004',up.active_company_id,'user_profile',up.id,r.severity,r.title,
             'active_company_id points to a tenant without an active membership.',md5('ACCESS-004:'||up.id::text||':'||up.active_company_id::text),
             jsonb_build_object('user_id',up.id,'active_company_id',up.active_company_id,'profile_status',up.user_status)
      from public.user_profiles up
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-004' and r.is_enabled
      where up.active_company_id is not null
        and not exists (
          select 1 from public.company_memberships cm
          where cm.company_id=up.active_company_id and cm.user_id=up.id
            and cm.status='active' and coalesce(cm.is_active,true)=true
        )
        and (p_company_id is null or up.active_company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-005',ci.company_id,'company_invitation',ci.id,r.severity,r.title,
             'Accepted invitation has no membership row for the invited tenant/user.',md5('ACCESS-005:'||ci.id::text),
             jsonb_build_object('invited_user_id',ci.invited_user_id,'invitation_status',ci.status,'role_key',ci.role_key,'membership_role',ci.membership_role)
      from public.company_invitations ci
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-005' and r.is_enabled
      where ci.status='accepted'
        and (ci.invited_user_id is null or not exists(
          select 1 from public.company_memberships cm where cm.company_id=ci.company_id and cm.user_id=ci.invited_user_id
        ))
        and (p_company_id is null or ci.company_id=p_company_id);
    end if;

    if v_scope in ('all','ediel') then
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-001',coalesce(em.company_id,c.company_id,s.company_id,mp.company_id,o.company_id,sw.company_id),
             'ediel_message',em.id,r.severity,r.title,
             'Outbound Ediel message tenant disagrees with one or more linked business entities.',md5('EDIEL-001:'||em.id::text),
             jsonb_build_object('message_company_id',em.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'outbound_company_id',o.company_id,'switch_company_id',sw.company_id,'status',em.status,'environment',em.environment)
      from public.ediel_messages em
      left join public.customers c on c.id=em.customer_id
      left join public.customer_sites s on s.id=em.site_id
      left join public.metering_points mp on mp.id=em.metering_point_id
      left join public.outbound_requests o on o.id=em.outbound_request_id
      left join public.supplier_switch_requests sw on sw.id=em.switch_request_id
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-001' and r.is_enabled
      where em.direction='outbound' and em.status<>'draft'
        and (
          (c.id is not null and em.company_id is distinct from c.company_id)
          or (s.id is not null and em.company_id is distinct from s.company_id)
          or (mp.id is not null and em.company_id is distinct from mp.company_id)
          or (o.id is not null and em.company_id is distinct from o.company_id)
          or (sw.id is not null and em.company_id is distinct from sw.company_id)
        )
        and (p_company_id is null or em.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or o.company_id=p_company_id or sw.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-002',coalesce(em.company_id,em.resolved_company_id),'ediel_message',em.id,r.severity,r.title,
             'Ediel message company_id disagrees with resolved_company_id.',md5('EDIEL-002:'||em.id::text),
             jsonb_build_object('company_id',em.company_id,'resolved_company_id',em.resolved_company_id,'direction',em.direction,'status',em.status,'tenant_resolution_status',em.tenant_resolution_status)
      from public.ediel_messages em
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-002' and r.is_enabled
      where em.company_id is not null and em.resolved_company_id is not null and em.company_id<>em.resolved_company_id
        and (p_company_id is null or em.company_id=p_company_id or em.resolved_company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-003',coalesce(eo.company_id,em.company_id),'ediel_outbox',eo.id,r.severity,r.title,
             'Sendable Ediel outbox tenant disagrees with its Ediel message tenant.',md5('EDIEL-003:'||eo.id::text),
             jsonb_build_object('outbox_company_id',eo.company_id,'message_company_id',em.company_id,'ediel_message_id',em.id,'outbox_status',eo.status,'environment',eo.environment)
      from public.ediel_outbox eo
      join public.ediel_messages em on em.id=eo.ediel_message_id
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-003' and r.is_enabled
      where eo.status in ('prepared','queued','sending','sent','delivery_uncertain')
        and eo.company_id is distinct from em.company_id
        and (p_company_id is null or eo.company_id=p_company_id or em.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-004',c.id,'ediel_outbox',eo.id,r.severity,r.title,
             'Tenant is blocked/frozen but production Ediel work remains sendable.',md5('EDIEL-004:'||eo.id::text),
             jsonb_build_object('company_status',c.status,'outbound_frozen',c.outbound_frozen,'ediel_production_status',c.ediel_production_status,'outbox_status',eo.status,'environment',eo.environment,'ediel_message_id',eo.ediel_message_id)
      from public.ediel_outbox eo
      join public.companies c on c.id=eo.company_id
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-004' and r.is_enabled
      where eo.environment='production' and eo.status in ('prepared','queued','sending')
        and (c.status in ('paused','suspended','archived','pending_deletion','closed','deleted_test_only') or coalesce(c.outbound_frozen,false)=true or c.ediel_production_status in ('paused','blocked'))
        and (p_company_id is null or c.id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-005',c.id,'company',c.id,r.severity,r.title,
             'Production Ediel is enabled/live but no active valid production actor setting exists.',md5('EDIEL-005:'||c.id::text),
             jsonb_build_object('ediel_production_enabled',c.ediel_production_enabled,'live_ediel_enabled',c.live_ediel_enabled,'ediel_production_status',c.ediel_production_status)
      from public.companies c
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-005' and r.is_enabled
      where (coalesce(c.ediel_production_enabled,false)=true or coalesce(c.live_ediel_enabled,false)=true or c.ediel_production_status='live')
        and not exists (
          select 1 from public.ediel_actor_settings eas
          where eas.company_id=c.id and eas.environment='production' and eas.is_active=true
            and (eas.valid_from is null or eas.valid_from<=current_date)
            and (eas.valid_to is null or eas.valid_to>=current_date)
        )
        and (p_company_id is null or c.id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-006',tep.company_id,'tenant_ediel_profile',min(tep.id),r.severity,r.title,
             'More than one currently active tenant Ediel profile overlaps for the same tenant/environment/market.',
             md5('EDIEL-006:'||tep.company_id::text||':'||tep.environment||':'||tep.market),
             jsonb_build_object('environment',tep.environment,'market',tep.market,'active_profile_count',count(*),'profile_ids',jsonb_agg(tep.id order by tep.valid_from,tep.id))
      from public.tenant_ediel_profiles tep
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-006' and r.is_enabled
      where tep.is_enabled=true and tep.valid_from<=now() and (tep.valid_to is null or tep.valid_to>now())
        and (p_company_id is null or tep.company_id=p_company_id)
      group by tep.company_id,tep.environment,tep.market,r.severity,r.title
      having count(*)>1;
    end if;

    select count(*)::integer,
           count(*) filter(where severity='critical')::integer,
           count(*) filter(where severity='high')::integer,
           count(*) filter(where severity='medium')::integer,
           count(*) filter(where severity='low')::integer,
           count(*) filter(where severity='info')::integer
      into v_total,v_critical,v_high,v_medium,v_low,v_info
    from public.tenant_integrity_findings where run_id=v_run_id;

    update public.tenant_integrity_audit_runs
    set status='completed',finished_at=now(),finding_count=v_total,critical_count=v_critical,high_count=v_high,
        medium_count=v_medium,low_count=v_low,info_count=v_info,
        metadata=metadata||jsonb_build_object('completed_at',now())
    where id=v_run_id;

    return jsonb_build_object('ok',true,'run_id',v_run_id,'company_id',p_company_id,'scope',v_scope,
      'finding_count',v_total,'critical_count',v_critical,'high_count',v_high,'medium_count',v_medium,'low_count',v_low,'info_count',v_info);
  exception when others then
    update public.tenant_integrity_audit_runs
    set status='failed',finished_at=now(),error_message=left(sqlerrm,2000)
    where id=v_run_id;
    return jsonb_build_object('ok',false,'run_id',v_run_id,'company_id',p_company_id,'scope',v_scope,'error',sqlerrm);
  end;
end
$function$;

revoke all on function public.run_tenant_integrity_audit(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.run_tenant_integrity_audit(uuid,text,uuid) to service_role;

create or replace view public.tenant_integrity_latest_runs_v
with (security_invoker=true)
as
select distinct on (coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),scope)
  id,company_id,scope,status,requested_by,started_at,finished_at,finding_count,critical_count,high_count,medium_count,low_count,info_count,error_message,metadata
from public.tenant_integrity_audit_runs
order by coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,started_at desc,id desc;

create or replace view public.tenant_integrity_latest_findings_v
with (security_invoker=true)
as
select f.*,r.category,r.enforcement_mode,r.description,r.remediation_hint,ar.scope,ar.started_at as audit_started_at,ar.finished_at as audit_finished_at
from public.tenant_integrity_findings f
join public.tenant_integrity_audit_runs ar on ar.id=f.run_id
join public.tenant_integrity_rule_registry r on r.rule_key=f.rule_key
where ar.status='completed'
  and ar.id in (
    select lr.id from public.tenant_integrity_latest_runs_v lr
  );

create or replace view public.tenant_integrity_company_summary_v
with (security_invoker=true)
as
select c.id as company_id,c.name as company_name,c.status as company_status,
       lr.id as latest_run_id,lr.started_at as audited_at,lr.finding_count,lr.critical_count,lr.high_count,lr.medium_count,lr.low_count,lr.info_count,
       case when lr.id is null then 'not_audited'
            when lr.status<>'completed' then lr.status
            when lr.critical_count>0 then 'critical'
            when lr.high_count>0 then 'attention'
            when lr.finding_count>0 then 'warning'
            else 'healthy' end as integrity_status
from public.companies c
left join lateral (
  select ar.* from public.tenant_integrity_audit_runs ar
  where ar.company_id=c.id and ar.scope='all'
  order by ar.started_at desc,ar.id desc limit 1
) lr on true
where c.status<>'deleted_test_only';

revoke all on public.tenant_integrity_latest_runs_v from public, anon, authenticated;
revoke all on public.tenant_integrity_latest_findings_v from public, anon, authenticated;
revoke all on public.tenant_integrity_company_summary_v from public, anon, authenticated;
grant select on public.tenant_integrity_latest_runs_v to service_role;
grant select on public.tenant_integrity_latest_findings_v to service_role;
grant select on public.tenant_integrity_company_summary_v to service_role;

comment on table public.tenant_integrity_rule_registry is 'Canonical registry of Gridex cross-table tenant integrity invariants.';
comment on table public.tenant_integrity_audit_runs is 'Immutable audit run envelope for tenant integrity checks.';
comment on table public.tenant_integrity_findings is 'Point-in-time tenant integrity findings with stable per-run fingerprints and evidence.';
comment on function public.run_tenant_integrity_audit(uuid,text,uuid) is 'Service-role-only cross-table tenant/access/operations/Ediel integrity auditor. Audit-only: never mutates business data.';

commit;
