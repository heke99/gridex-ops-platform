-- Signed commercial amendments preserve the original physical supply and
-- signed history. The first supported shape is an indefinite consumption
-- agreement at a future first-of-month boundary. Normal legal/POA/customer
-- signing remains authoritative; native consumers independently bind the new
-- commercial version. Unknown original-function images abort installation.
begin;
do $$begin
 if exists(select from public.customer_contract_signature_requests where metadata?'amendment_context' or metadata?'amendment_context_sha256') then
  raise exception 'signed_amendment_reserved_request_metadata_exists';end if;
end$$;
create schema gridex_contract_amendment;
revoke all on schema gridex_contract_amendment from public,anon,authenticated,service_role;
create table gridex_contract_amendment.proposals (
 id uuid primary key,
 company_id uuid not null,
 customer_id uuid not null,
 predecessor_contract_id uuid not null references public.customer_contracts(id),
 successor_contract_id uuid not null references public.customer_contracts(id),
 effective_from date not null,
 actor_user_id uuid not null,
 reason text not null check(length(reason) between 1 and 1000),
 request_json jsonb not null,
 request_sha256 text not null,
 predecessor_terms jsonb not null,
 successor_terms jsonb not null,
 predecessor_price_snapshot_id uuid not null references public.contract_price_snapshots(id),
 successor_price_snapshot_id uuid not null references public.contract_price_snapshots(id),
 predecessor_price_sha256 text not null,
 successor_price_sha256 text not null,
 predecessor_signature_sha256 text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(predecessor_contract_id<>successor_contract_id),
 unique(company_id,successor_contract_id)
);
create index amendment_proposals_predecessor_idx on gridex_contract_amendment.proposals(company_id,predecessor_contract_id);
alter table gridex_contract_amendment.proposals enable row level security;
alter table gridex_contract_amendment.proposals force row level security;
revoke all on gridex_contract_amendment.proposals from public,anon,authenticated,service_role;
create function gridex_contract_amendment.immutable_v1() returns trigger
language plpgsql set search_path=pg_catalog as $$begin
 raise exception using errcode='55000',message='signed_amendment_proposal_immutable';
end$$;
create trigger amendment_proposal_immutable before update or delete on gridex_contract_amendment.proposals
for each row execute function gridex_contract_amendment.immutable_v1();
create trigger amendment_proposal_no_truncate before truncate on gridex_contract_amendment.proposals
for each statement execute function gridex_contract_amendment.immutable_v1();

create function gridex_contract_amendment.terms_v1(c jsonb) returns jsonb
language sql immutable strict set search_path=pg_catalog as $$
 select jsonb_object_agg(key,value) from jsonb_each(c) where key=any(array[
 'id','company_id','customer_id','site_id','customer_site_id','metering_point_id','energy_direction',
 'contract_name','contract_number','contract_type','starts_at','ends_at','binding_months','notice_months',
 'auto_renew_enabled','auto_renew_term_months','monthly_fee_sek','invoice_fee_sek',
 'fixed_price_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh','vat_rate',
 'start_fee_sek','admin_fee_sek','break_fee_sek','discount_value','discount_unit','discount_months',
 'optional_fee_lines','price_snapshot','commercial_snapshot','contract_offer_id','public_contract_offer_id',
 'contract_product_id','contract_product_version_id','contract_publication_version_id',
 'contract_price_snapshot_id','price_plan_id','price_plan_version_id','price_book_id','legal_bundle_version_id',
 'contract_version','terms_version','offer_reference','quote_reference','legal_snapshot',
 'tenant_communication_snapshot','tenant_communication_snapshot_sha256','tenant_legal_party_snapshot',
 'campaign_snapshot','campaign_code','campaign_version','expected_start_at','price_area_used',
 'markup_ore_per_kwh','green_fee_mode','green_fee_value'])
$$;

create function public.gridex_propose_signed_contract_amendment_v1(
 p_company_id uuid,p_customer_id uuid,p_predecessor_id uuid,p_successor_id uuid,p_effective_from date,
 p_actor_user_id uuid,p_request_id uuid,p_reason text,p_acknowledge_new_signature boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 old_contract public.customer_contracts%rowtype;
 new_contract public.customer_contracts%rowtype;
 old_price public.contract_price_snapshots%rowtype;
 new_price public.contract_price_snapshots%rowtype;
 prior gridex_contract_amendment.proposals%rowtype;
 command jsonb;old_terms jsonb;new_terms jsonb;command_hash text;recipient text;
begin
 -- Current tenant grants and DENY rules precede idempotency. Global platform
 -- permission alone cannot replace an active local membership and local grant.
 if auth.role() is distinct from 'service_role' or p_actor_user_id is null
  or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.write'),false)
  or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.create'),false)
  or not coalesce('contracts.write'=any(public.gridex_get_user_permissions_in_company(p_actor_user_id,p_company_id)),false)
  or not coalesce('contracts.create'=any(public.gridex_get_user_permissions_in_company(p_actor_user_id,p_company_id)),false)
  or not exists(select from public.company_memberships m where m.company_id=p_company_id and m.user_id=p_actor_user_id
   and m.status='active' and m.is_active) then
  raise exception using errcode='42501',message='signed_amendment_permission_denied';
 end if;
 if p_customer_id is null or p_predecessor_id is null or p_successor_id is null or p_request_id is null
  or p_effective_from is null or not isfinite(p_effective_from) or p_predecessor_id=p_successor_id then
  raise exception using errcode='23514',message='signed_amendment_scope_invalid';
 end if;
 if p_acknowledge_new_signature is distinct from true or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
  or p_reason~'[[:cntrl:]]' then raise exception using errcode='22023',message='signed_amendment_explicit_proposal_required';end if;
 -- Same global per-company billing lock comes before row locks, including at
 -- eventual acceptance; no inversion against native underlay finalization.
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
 perform id from public.companies where id=p_company_id and is_active and lifecycle_status='active' and status='active' for share;
 if not found then raise exception using errcode='23514',message='signed_amendment_company_inactive';end if;
 perform id from public.customer_contracts where company_id=p_company_id and id in(p_predecessor_id,p_successor_id) order by id for update;
 perform gridex_contract_amendment.assert_staff_v1(p_company_id,p_actor_user_id);
 -- Immutable command replay is a read of the original proposal. Prepared,
 -- signed, retired or elapsed state must not turn the SAME command into a
 -- fresh-proposal eligibility check; current tenant authority is still required.
 select * into prior from gridex_contract_amendment.proposals where id=p_request_id;
 if found then
  if prior.company_id is distinct from p_company_id or prior.customer_id is distinct from p_customer_id
   or prior.predecessor_contract_id is distinct from p_predecessor_id or prior.successor_contract_id is distinct from p_successor_id
   or prior.effective_from is distinct from p_effective_from or prior.actor_user_id is distinct from p_actor_user_id
   or prior.reason is distinct from btrim(p_reason) then
   raise exception using errcode='22023',message='signed_amendment_request_conflict';end if;
  select * into old_contract from public.customer_contracts where id=prior.predecessor_contract_id and company_id=prior.company_id and customer_id=prior.customer_id;
  select * into new_contract from public.customer_contracts where id=prior.successor_contract_id and company_id=prior.company_id and customer_id=prior.customer_id;
  if old_contract.id is null or new_contract.id is null
   or gridex_contract_amendment.terms_v1(to_jsonb(old_contract)) is distinct from prior.predecessor_terms
   or gridex_contract_amendment.terms_v1(to_jsonb(new_contract)) is distinct from prior.successor_terms
   or old_contract.signature_snapshot_sha256 is distinct from prior.predecessor_signature_sha256
   or old_contract.signature_snapshot_sha256 is distinct from public.canonical_json_sha256(old_contract.signature_snapshot)
   or not exists(select from public.contract_price_snapshots ps where ps.id=prior.predecessor_price_snapshot_id and ps.company_id=prior.company_id and ps.customer_id=prior.customer_id and ps.contract_id=prior.predecessor_contract_id and ps.snapshot_hash=prior.predecessor_price_sha256 and ps.snapshot_hash=public.canonical_json_sha256(ps.snapshot_json))
   or not exists(select from public.contract_price_snapshots ps where ps.id=prior.successor_price_snapshot_id and ps.company_id=prior.company_id and ps.customer_id=prior.customer_id and ps.contract_id=prior.successor_contract_id and ps.snapshot_hash=prior.successor_price_sha256 and ps.snapshot_hash=public.canonical_json_sha256(ps.snapshot_json))
   or prior.request_sha256 is distinct from public.canonical_json_sha256(prior.request_json) then
   raise exception using errcode='23514',message='signed_amendment_proposal_material_changed';end if;
  return jsonb_build_object('state','PROPOSED_NOT_ACCEPTED','proposalId',prior.id,'predecessorContractId',prior.predecessor_contract_id,
   'successorContractId',prior.successor_contract_id,'effectiveFrom',prior.effective_from,'proposalSHA256',prior.request_sha256);
 end if;

 select * into old_contract from public.customer_contracts where company_id=p_company_id and customer_id=p_customer_id and id=p_predecessor_id;
 select * into new_contract from public.customer_contracts where company_id=p_company_id and customer_id=p_customer_id and id=p_successor_id;
 if old_contract.id is null or new_contract.id is null
  or old_contract.status not in('signed','active') or old_contract.signed_at is null or old_contract.locked_at is null
  or old_contract.signature_snapshot_sha256 is distinct from public.canonical_json_sha256(old_contract.signature_snapshot)
  or new_contract.status not in('draft','pending_signature','signature_failed') or new_contract.signed_at is not null or new_contract.locked_at is not null
  or coalesce(new_contract.signature_snapshot,'{}'::jsonb)<>'{}'::jsonb
  or old_contract.metering_point_id is null or old_contract.metering_point_id is distinct from new_contract.metering_point_id
  or coalesce(old_contract.customer_site_id,old_contract.site_id) is null
  or coalesce(old_contract.customer_site_id,old_contract.site_id) is distinct from coalesce(new_contract.customer_site_id,new_contract.site_id)
  or old_contract.energy_direction is distinct from 'consumption' or new_contract.energy_direction is distinct from 'consumption'
  or new_contract.contract_offer_id is null or old_contract.contract_price_snapshot_id is null then
  raise exception using errcode='23514',message='signed_amendment_exact_contracts_required';
 end if;
 -- The ordinary creation path may defer its canonical CPS until normal
 -- signing preparation. Reuse that exact command under these same locks;
 -- its private freeze-only token is never delivered to a customer. All unused
 -- requests are revoked atomically below before this proposal becomes visible.
 if new_contract.contract_price_snapshot_id is null then
  select email into recipient from public.customers where id=p_customer_id and company_id=p_company_id;
  if nullif(btrim(recipient),'') is null or position('@' in recipient)=0 then
   raise exception using errcode='23514',message='signed_amendment_preparation_recipient_required';end if;
  perform public.gridex_prepare_customer_contract_signature_request_v1(p_company_id,p_customer_id,p_successor_id,
   public.canonical_json_sha256(jsonb_build_object('requestId',p_request_id,'purpose','amendment_freeze_only','nonce',gen_random_uuid())),
   recipient,clock_timestamp()+interval '1 hour',p_actor_user_id,'internal');
  select * into new_contract from public.customer_contracts where company_id=p_company_id and customer_id=p_customer_id and id=p_successor_id;
 end if;
 -- The first supported route has no mid-month fee allocation or binding reset.
 -- Other term shapes remain unsupported instead of inventing a policy.
 if coalesce(old_contract.binding_months,0)<>0 or coalesce(new_contract.binding_months,0)<>0
  or old_contract.ends_at is not null or new_contract.ends_at is not null
  or coalesce(old_contract.auto_renew_enabled,false) or coalesce(new_contract.auto_renew_enabled,false)
  or old_contract.notice_months is distinct from new_contract.notice_months
  or coalesce(old_contract.start_fee_sek,0)<>0 or coalesce(new_contract.start_fee_sek,0)<>0
  or coalesce(old_contract.admin_fee_sek,0)<>0 or coalesce(new_contract.admin_fee_sek,0)<>0
  or coalesce(old_contract.break_fee_sek,0)<>0 or coalesce(new_contract.break_fee_sek,0)<>0
  or coalesce(old_contract.discount_value,0)<>0 or coalesce(new_contract.discount_value,0)<>0
  or coalesce(old_contract.optional_fee_lines,'[]'::jsonb)<>'[]'::jsonb or coalesce(new_contract.optional_fee_lines,'[]'::jsonb)<>'[]'::jsonb then
  raise exception using errcode='23514',message='signed_amendment_term_shape_unsupported';
 end if;
 if p_effective_from<=(clock_timestamp() at time zone 'Europe/Stockholm')::date
  or extract(day from p_effective_from)<>1
  or left(new_contract.starts_at::text,10)::date is distinct from p_effective_from
  or old_contract.starts_at is null or left(old_contract.starts_at::text,10)::date>=p_effective_from then
  raise exception using errcode='23514',message='signed_amendment_future_boundary_required';
 end if;
 select * into old_price from public.contract_price_snapshots where id=old_contract.contract_price_snapshot_id and company_id=p_company_id and customer_id=p_customer_id and contract_id=p_predecessor_id for share;
 select * into new_price from public.contract_price_snapshots where id=new_contract.contract_price_snapshot_id and company_id=p_company_id and customer_id=p_customer_id and contract_id=p_successor_id for share;
 if old_price.id is null or new_price.id is null or old_price.id=new_price.id
  or old_price.snapshot_quality is distinct from 'canonical' or new_price.snapshot_quality is distinct from 'canonical'
  or old_price.price_plan_version_id is distinct from old_contract.price_plan_version_id
  or new_price.price_plan_version_id is distinct from new_contract.price_plan_version_id
  or old_price.snapshot_hash is distinct from public.canonical_json_sha256(old_price.snapshot_json)
  or new_price.snapshot_hash is distinct from public.canonical_json_sha256(new_price.snapshot_json) then
  raise exception using errcode='23514',message='signed_amendment_snapshot_binding_invalid';
 end if;
 if exists(select from public.billing_underlays u join gridex_billing_source.underlay_bindings b on b.underlay_id=u.id
  where u.company_id=p_company_id and u.customer_id=p_customer_id and u.metering_point_id=old_contract.metering_point_id
   and u.billing_period_end>p_effective_from) then
  raise exception using errcode='23514',message='signed_amendment_finalized_billing_overlap';
 end if;
 if p_effective_from<=(clock_timestamp() at time zone 'Europe/Stockholm')::date then
  raise exception using errcode='23514',message='signed_amendment_future_boundary_required';end if;
 if gridex_contract_amendment.has_competing_proposal_v1(p_company_id,p_predecessor_id,p_request_id,(clock_timestamp() at time zone 'Europe/Stockholm')::date) then
  raise exception using errcode='23514',message='signed_amendment_active_proposal_exists';end if;
 -- No previously exposed plain signing link may silently accept an amendment
 -- without showing its context. This revocation and proposal commit together.
 update public.customer_contract_signature_requests set revoked_at=clock_timestamp()
  where company_id=p_company_id and customer_contract_id=p_successor_id and used_at is null and revoked_at is null;
 perform gridex_contract_amendment.assert_staff_v1(p_company_id,p_actor_user_id);
 if p_effective_from<=(clock_timestamp() at time zone 'Europe/Stockholm')::date then
  raise exception using errcode='23514',message='signed_amendment_future_boundary_required';end if;
 old_terms:=gridex_contract_amendment.terms_v1(to_jsonb(old_contract));new_terms:=gridex_contract_amendment.terms_v1(to_jsonb(new_contract));
 command:=jsonb_build_object('company',p_company_id,'customer',p_customer_id,'predecessor',p_predecessor_id,'successor',p_successor_id,
  'effectiveFrom',p_effective_from,'actor',p_actor_user_id,'reason',btrim(p_reason),'oldTermsHash',public.canonical_json_sha256(old_terms),
  'newTermsHash',public.canonical_json_sha256(new_terms),'oldPriceHash',old_price.snapshot_hash,'newPriceHash',new_price.snapshot_hash,
  'oldSignatureHash',old_contract.signature_snapshot_sha256);
 command_hash:=public.canonical_json_sha256(command);
 select * into prior from gridex_contract_amendment.proposals where id=p_request_id;
 if found then
  if prior.company_id is distinct from p_company_id or prior.request_sha256 is distinct from command_hash or prior.request_json is distinct from command then
   raise exception using errcode='22023',message='signed_amendment_request_conflict';end if;
 else
  insert into gridex_contract_amendment.proposals values(p_request_id,p_company_id,p_customer_id,p_predecessor_id,p_successor_id,p_effective_from,
   p_actor_user_id,btrim(p_reason),command,command_hash,old_terms,new_terms,old_price.id,new_price.id,old_price.snapshot_hash,new_price.snapshot_hash,
   old_contract.signature_snapshot_sha256,clock_timestamp()) returning * into prior;
 end if;
 return jsonb_build_object('state','PROPOSED_NOT_ACCEPTED','proposalId',prior.id,'predecessorContractId',prior.predecessor_contract_id,
  'successorContractId',prior.successor_contract_id,'effectiveFrom',prior.effective_from,'proposalSHA256',prior.request_sha256);
end$$;
revoke all on all functions in schema gridex_contract_amendment from public,anon,authenticated,service_role;
revoke all on function public.gridex_propose_signed_contract_amendment_v1(uuid,uuid,uuid,uuid,date,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.gridex_propose_signed_contract_amendment_v1(uuid,uuid,uuid,uuid,date,uuid,uuid,text,boolean) to service_role;
-- Immutable historical acceptance records. Only the explicit customer route
-- may seal an edge atomically with the ordinary canonical signature.
create table gridex_contract_amendment.acceptances (
 proposal_id uuid primary key references gridex_contract_amendment.proposals(id),
 company_id uuid not null,
 predecessor_contract_id uuid not null,
 signature_snapshot jsonb not null,
 signature_sha256 text not null,
 accepted_at timestamptz not null,
 acceptance_context jsonb not null,
 acceptance_sha256 text not null,
 unique(company_id,predecessor_contract_id)
);
create function gridex_contract_amendment.acceptance_subject_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare p gridex_contract_amendment.proposals%rowtype;
begin
 select * into p from gridex_contract_amendment.proposals where id=new.proposal_id;
 if p.id is null or new.company_id is not null and new.company_id<>p.company_id
  or new.predecessor_contract_id is not null and new.predecessor_contract_id<>p.predecessor_contract_id then
  raise exception using errcode='23514',message='signed_amendment_acceptance_subject_invalid';end if;
 new.company_id:=p.company_id;new.predecessor_contract_id:=p.predecessor_contract_id;return new;
end$$;
create trigger amendment_acceptance_subject before insert on gridex_contract_amendment.acceptances
for each row execute function gridex_contract_amendment.acceptance_subject_v1();
alter table gridex_contract_amendment.acceptances enable row level security;
alter table gridex_contract_amendment.acceptances force row level security;
revoke all on gridex_contract_amendment.acceptances from public,anon,authenticated,service_role;
create trigger amendment_acceptance_immutable before update or delete on gridex_contract_amendment.acceptances
for each row execute function gridex_contract_amendment.immutable_v1();
create trigger amendment_acceptance_no_truncate before truncate on gridex_contract_amendment.acceptances
for each statement execute function gridex_contract_amendment.immutable_v1();

create function gridex_contract_amendment.has_competing_proposal_v1(c uuid,pred uuid,current_proposal uuid,today date)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select from gridex_contract_amendment.proposals p
  left join gridex_contract_amendment.acceptances a on a.proposal_id=p.id
  left join public.customer_contracts successor on successor.id=p.successor_contract_id and successor.company_id=p.company_id and successor.customer_id=p.customer_id
  where p.company_id=c and p.predecessor_contract_id=pred and p.id<>current_proposal and (
   a.proposal_id is not null or successor.id is null or successor.signed_at is not null or successor.locked_at is not null
   or successor.signature_snapshot_sha256 is not null or coalesce(successor.signature_snapshot,'{}'::jsonb)<>'{}'::jsonb
   or successor.status not in('draft','pending_signature','signature_failed','cancelled')
   or successor.status<>'cancelled' and p.effective_from>today))
$$;

create function gridex_contract_amendment.context_v1(proposal uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('schema','gridex_signed_contract_amendment_v1','proposalId',p.id,'proposalSHA256',p.request_sha256,
  'predecessorContractId',p.predecessor_contract_id,'successorContractId',p.successor_contract_id,'effectiveFrom',p.effective_from,
  'predecessorReference',coalesce(nullif(p.predecessor_terms->>'contract_number',''),p.predecessor_contract_id::text),
  'predecessorSignatureSHA256',p.predecessor_signature_sha256,
  'predecessorPriceSnapshotId',p.predecessor_price_snapshot_id,'successorPriceSnapshotId',p.successor_price_snapshot_id,
  'predecessorPriceSHA256',p.predecessor_price_sha256,'successorPriceSHA256',p.successor_price_sha256,
  'predecessorTermsSHA256',public.canonical_json_sha256(p.predecessor_terms),
  'successorTermsSHA256',public.canonical_json_sha256(p.successor_terms))
 from gridex_contract_amendment.proposals p where p.id=proposal
$$;

create function gridex_contract_amendment.verified_link_v1(proposal uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p gridex_contract_amendment.proposals%rowtype;a gridex_contract_amendment.acceptances%rowtype;
 old_contract public.customer_contracts%rowtype;new_contract public.customer_contracts%rowtype;
 old_price public.contract_price_snapshots%rowtype;new_price public.contract_price_snapshots%rowtype;context jsonb;
begin
 select * into p from gridex_contract_amendment.proposals where id=proposal;
 select * into a from gridex_contract_amendment.acceptances where proposal_id=proposal;
 select * into old_contract from public.customer_contracts where id=p.predecessor_contract_id and company_id=p.company_id and customer_id=p.customer_id;
 select * into new_contract from public.customer_contracts where id=p.successor_contract_id and company_id=p.company_id and customer_id=p.customer_id;
 select * into old_price from public.contract_price_snapshots where id=p.predecessor_price_snapshot_id and company_id=p.company_id and customer_id=p.customer_id and contract_id=p.predecessor_contract_id;
 select * into new_price from public.contract_price_snapshots where id=p.successor_price_snapshot_id and company_id=p.company_id and customer_id=p.customer_id and contract_id=p.successor_contract_id;
 context:=gridex_contract_amendment.context_v1(proposal);
 if p.id is null or a.proposal_id is null or a.company_id is distinct from p.company_id or a.predecessor_contract_id is distinct from p.predecessor_contract_id or old_contract.id is null or new_contract.id is null or old_price.id is null or new_price.id is null
  or old_contract.metering_point_id is null or old_contract.metering_point_id is distinct from new_contract.metering_point_id
  or coalesce(old_contract.customer_site_id,old_contract.site_id) is distinct from coalesce(new_contract.customer_site_id,new_contract.site_id)
  or old_contract.energy_direction is distinct from new_contract.energy_direction or new_contract.energy_direction is distinct from 'consumption'
  or new_contract.status not in('signed','active','terminated') or new_contract.signed_at is null or new_contract.locked_at is null
  or gridex_contract_amendment.terms_v1(to_jsonb(old_contract)) is distinct from p.predecessor_terms
  or gridex_contract_amendment.terms_v1(to_jsonb(new_contract)) is distinct from p.successor_terms
  or old_contract.contract_price_snapshot_id is distinct from old_price.id or new_contract.contract_price_snapshot_id is distinct from new_price.id
  or old_contract.price_plan_version_id is distinct from old_price.price_plan_version_id or new_contract.price_plan_version_id is distinct from new_price.price_plan_version_id
  or old_price.snapshot_quality is distinct from 'canonical' or new_price.snapshot_quality is distinct from 'canonical'
  or old_price.snapshot_hash is distinct from p.predecessor_price_sha256 or new_price.snapshot_hash is distinct from p.successor_price_sha256
  or old_price.snapshot_hash is distinct from public.canonical_json_sha256(old_price.snapshot_json)
  or new_price.snapshot_hash is distinct from public.canonical_json_sha256(new_price.snapshot_json)
  or old_contract.signature_snapshot_sha256 is distinct from p.predecessor_signature_sha256
  or old_contract.signature_snapshot_sha256 is distinct from public.canonical_json_sha256(old_contract.signature_snapshot)
  or a.signature_snapshot is distinct from new_contract.signature_snapshot
  or a.signature_sha256 is distinct from new_contract.signature_snapshot_sha256
  or a.signature_sha256 is distinct from public.canonical_json_sha256(a.signature_snapshot)
  or a.acceptance_context is distinct from context or a.signature_snapshot->'amendment_context' is distinct from context
  or a.accepted_at is distinct from new_contract.signed_at or a.accepted_at<p.created_at or a.accepted_at>clock_timestamp()
  or a.accepted_at>=(p.effective_from::timestamp at time zone 'Europe/Stockholm')
  or a.acceptance_sha256 is distinct from public.canonical_json_sha256(jsonb_build_object('context',context,'signatureSHA256',a.signature_sha256,'acceptedAt',a.accepted_at)) then
  raise exception using errcode='23514',message='signed_amendment_accepted_link_invalid';
 end if;
 return jsonb_build_object('proposalId',p.id,'predecessorContractId',p.predecessor_contract_id,'successorContractId',p.successor_contract_id,
  'customerId',p.customer_id,'meteringPointId',new_contract.metering_point_id,'effectiveFrom',p.effective_from,
  'priceSnapshotId',p.successor_price_snapshot_id,'acceptanceSHA256',a.acceptance_sha256);
end$$;

create function gridex_contract_amendment.instant_v1(t timestamptz) returns text
language sql immutable strict set search_path=pg_catalog as $$select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')$$;

create function public.gridex_read_contract_commercial_segments_v1(p_company_id uuid,p_supply_period_id uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare sp public.customer_supply_periods%rowtype;root public.customer_contracts%rowtype;p gridex_contract_amendment.proposals%rowtype;
 source_basis jsonb;segments jsonb:='[]';prefix jsonb:='[]';proof jsonb;result jsonb;
 selected_contract uuid;selected_price uuid;selected_acceptance text;cursor_at timestamptz;boundary timestamptz;
 previous_boundary timestamptz:='-infinity';seen uuid[];steps integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='signed_amendment_service_required';end if;
 if p_company_id is null or p_supply_period_id is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_end<=p_start or date_trunc('second',p_start)<>p_start or date_trunc('second',p_end)<>p_end then
  raise exception using errcode='23514',message='signed_amendment_exact_segment_scope_required';end if;
 -- Preserve the existing source owner's global-graph-before-source-row order.
 perform gridex_bilateral_prodat.lock_supply_v1();
 perform gridex_regulated_supply.lock_graph_v1();
 select * into sp from public.customer_supply_periods where id=p_supply_period_id and company_id=p_company_id for share;
 select * into root from public.customer_contracts where id=sp.contract_id and company_id=p_company_id and customer_id=sp.customer_id and metering_point_id=sp.metering_point_id for share;
 if sp.id is null or root.id is null or sp.status not in('active','confirmed_by_grid_owner','ended')
  or root.status not in('signed','active','terminated') or root.signed_at is null or root.locked_at is null
  or sp.start_date is null
  or (sp.start_date::timestamp at time zone 'Europe/Stockholm')>p_start
  or sp.end_date is not null and ((sp.end_date+1)::timestamp at time zone 'Europe/Stockholm')<p_end
  or sp.status='ended' and sp.end_date is null then
  raise exception using errcode='23514',message='signed_amendment_physical_scope_invalid';end if;
 source_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,p_start,p_end);
 if source_basis is null or source_basis->'qualified' is distinct from 'true'::jsonb
  or source_basis->>'periodId' is distinct from sp.id::text
  or source_basis->>'customerId' is distinct from sp.customer_id::text
  or source_basis->>'meteringPointId' is distinct from sp.metering_point_id::text then
  raise exception using errcode='23514',message='signed_amendment_physical_source_unqualified';end if;
 selected_contract:=root.id;cursor_at:=p_start;seen:=array[root.id];
 loop
  select proposal.* into p from gridex_contract_amendment.proposals proposal
   join gridex_contract_amendment.acceptances acceptance on acceptance.proposal_id=proposal.id
   where proposal.company_id=p_company_id and proposal.predecessor_contract_id=selected_contract;
  if not found then exit;end if;
  boundary:=p.effective_from::timestamp at time zone 'Europe/Stockholm';
  -- A new future link cannot change an already locked historical assignment.
  if boundary>=p_end then exit;end if;
  steps:=steps+1;
  if steps>32 or p.successor_contract_id=any(seen) or boundary<=previous_boundary then
   raise exception using errcode='23514',message='signed_amendment_chain_invalid';end if;
  proof:=gridex_contract_amendment.verified_link_v1(p.id);
  if proof->>'customerId' is distinct from sp.customer_id::text or proof->>'meteringPointId' is distinct from sp.metering_point_id::text then
   raise exception using errcode='23514',message='signed_amendment_chain_physical_scope_changed';end if;
  if boundary>cursor_at then
   segments:=segments||jsonb_build_array(jsonb_build_object('start',gridex_contract_amendment.instant_v1(cursor_at),
    'end',gridex_contract_amendment.instant_v1(boundary),'contractId',selected_contract,'priceSnapshotId',selected_price,'acceptanceSHA256',selected_acceptance));
   cursor_at:=boundary;
  end if;
  selected_contract:=p.successor_contract_id;selected_price:=p.successor_price_snapshot_id;selected_acceptance:=proof->>'acceptanceSHA256';
  previous_boundary:=boundary;seen:=array_append(seen,selected_contract);prefix:=prefix||jsonb_build_array(proof);
 end loop;
 segments:=segments||jsonb_build_array(jsonb_build_object('start',gridex_contract_amendment.instant_v1(cursor_at),
  'end',gridex_contract_amendment.instant_v1(p_end),'contractId',selected_contract,'priceSnapshotId',selected_price,'acceptanceSHA256',selected_acceptance));
 result:=jsonb_build_object('schema','gridex-contract-commercial-segments-v1','companyId',sp.company_id,'customerId',sp.customer_id,
  'meteringPointId',sp.metering_point_id,'supplyPeriodId',sp.id,'physicalContractId',root.id,
  'start',gridex_contract_amendment.instant_v1(p_start),'end',gridex_contract_amendment.instant_v1(p_end),'segments',segments);
 return result||jsonb_build_object('assignmentSHA256',public.canonical_json_sha256(result||jsonb_build_object('physicalSourceBasis',source_basis,'acceptedPrefix',prefix)));
end$$;
revoke all on all functions in schema gridex_contract_amendment from public,anon,authenticated,service_role;
revoke all on function public.gridex_read_contract_commercial_segments_v1(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.gridex_read_contract_commercial_segments_v1(uuid,uuid,timestamptz,timestamptz) to service_role;

-- Explicit customer consent is transaction-bound and never a caller GUC/label.
create table gridex_contract_amendment.acceptance_intents (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null unique references gridex_contract_amendment.proposals(id),
 request_id uuid not null unique references public.customer_contract_signature_requests(id),
 token_hash text not null check(token_hash~'^[0-9a-f]{64}$'),
 context_sha256 text not null check(context_sha256~'^[0-9a-f]{64}$'),
 explicit_customer_accepted boolean not null check(explicit_customer_accepted),
 creating_txid bigint not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table gridex_contract_amendment.acceptance_intents enable row level security;
alter table gridex_contract_amendment.acceptance_intents force row level security;
revoke all on gridex_contract_amendment.acceptance_intents from public,anon,authenticated,service_role;
create trigger amendment_intent_immutable before update or delete on gridex_contract_amendment.acceptance_intents
for each row execute function gridex_contract_amendment.immutable_v1();
create trigger amendment_intent_no_truncate before truncate on gridex_contract_amendment.acceptance_intents
for each statement execute function gridex_contract_amendment.immutable_v1();

create function gridex_contract_amendment.assert_staff_v1(c uuid,actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.role() is distinct from 'service_role' or actor is null
  or not coalesce(public.gridex_actor_has_company_permission(actor,c,'contracts.write'),false)
  or not coalesce(public.gridex_actor_has_company_permission(actor,c,'contracts.create'),false)
  or not coalesce('contracts.write'=any(public.gridex_get_user_permissions_in_company(actor,c)),false)
  or not coalesce('contracts.create'=any(public.gridex_get_user_permissions_in_company(actor,c)),false)
  or not exists(select from public.company_memberships m where m.company_id=c and m.user_id=actor and m.status='active' and m.is_active) then
  raise exception using errcode='42501',message='signed_amendment_permission_denied';end if;
end$$;

create function gridex_contract_amendment.current_context_v1(proposal uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p gridex_contract_amendment.proposals%rowtype;before public.customer_contracts%rowtype;after public.customer_contracts%rowtype;
 old_price public.contract_price_snapshots%rowtype;new_price public.contract_price_snapshots%rowtype;
begin
 select * into p from gridex_contract_amendment.proposals where id=proposal;
 select * into before from public.customer_contracts where id=p.predecessor_contract_id and company_id=p.company_id and customer_id=p.customer_id;
 select * into after from public.customer_contracts where id=p.successor_contract_id and company_id=p.company_id and customer_id=p.customer_id;
 select * into old_price from public.contract_price_snapshots where id=p.predecessor_price_snapshot_id and company_id=p.company_id and customer_id=p.customer_id and contract_id=p.predecessor_contract_id;
 select * into new_price from public.contract_price_snapshots where id=p.successor_price_snapshot_id and company_id=p.company_id and customer_id=p.customer_id and contract_id=p.successor_contract_id;
 if p.id is null or before.id is null or after.id is null or old_price.id is null or new_price.id is null
  or before.status not in('signed','active') or before.signed_at is null or before.locked_at is null
  or after.status not in('draft','pending_signature','signature_failed') or after.signed_at is not null or after.locked_at is not null
  or gridex_contract_amendment.terms_v1(to_jsonb(before)) is distinct from p.predecessor_terms
  or gridex_contract_amendment.terms_v1(to_jsonb(after)) is distinct from p.successor_terms
  or before.signature_snapshot_sha256 is distinct from p.predecessor_signature_sha256
  or before.signature_snapshot_sha256 is distinct from public.canonical_json_sha256(before.signature_snapshot)
  or before.contract_price_snapshot_id is distinct from old_price.id or after.contract_price_snapshot_id is distinct from new_price.id
  or old_price.snapshot_hash is distinct from p.predecessor_price_sha256 or new_price.snapshot_hash is distinct from p.successor_price_sha256
  or old_price.snapshot_hash is distinct from public.canonical_json_sha256(old_price.snapshot_json)
  or new_price.snapshot_hash is distinct from public.canonical_json_sha256(new_price.snapshot_json)
  or p.request_sha256 is distinct from public.canonical_json_sha256(p.request_json) then
  raise exception using errcode='23514',message='signed_amendment_proposal_material_changed';end if;
 return gridex_contract_amendment.context_v1(p.id);
end$$;

create function gridex_contract_amendment.prepare_context_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare p gridex_contract_amendment.proposals%rowtype;context jsonb;hash text;
begin
 select * into p from gridex_contract_amendment.proposals where company_id=new.company_id and successor_contract_id=new.customer_contract_id;
 if not found then
  if new.metadata?'amendment_context' or new.metadata?'amendment_context_sha256' then
   raise exception using errcode='23514',message='signed_amendment_unregistered_context';end if;
  return new;
 end if;
 if new.customer_id is distinct from p.customer_id then raise exception using errcode='23514',message='signed_amendment_request_scope_invalid';end if;
 perform gridex_contract_amendment.assert_staff_v1(new.company_id,new.created_by);
 context:=gridex_contract_amendment.current_context_v1(p.id);hash:=public.canonical_json_sha256(context);
 if p.effective_from<=(clock_timestamp() at time zone 'Europe/Stockholm')::date then
  raise exception using errcode='23514',message='signed_amendment_future_boundary_required';end if;
 if new.metadata?'amendment_context' and new.metadata->'amendment_context' is distinct from context
  or new.metadata?'amendment_context_sha256' and new.metadata->>'amendment_context_sha256' is distinct from hash then
  raise exception using errcode='23514',message='signed_amendment_request_context_invalid';end if;
 new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('amendment_context',context,'amendment_context_sha256',hash);
 new.expires_at:=least(new.expires_at,p.effective_from::timestamp at time zone 'Europe/Stockholm');
 if new.expires_at is null or new.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='signed_amendment_request_expired';end if;
 return new;
end$$;
create trigger aa_signed_amendment_prepare_context before insert on public.customer_contract_signature_requests
for each row execute function gridex_contract_amendment.prepare_context_v1();

create function gridex_contract_amendment.request_context_immutable_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare proposal uuid;context jsonb;
begin
 if tg_op='UPDATE' and (new.metadata?'amendment_context' or new.metadata?'amendment_context_sha256') then
  select p.id into proposal from gridex_contract_amendment.proposals p where p.company_id=new.company_id
   and p.customer_id=new.customer_id and p.successor_contract_id=new.customer_contract_id;
  if proposal is null then raise exception using errcode='23514',message='signed_amendment_unregistered_context';end if;
  context:=gridex_contract_amendment.context_v1(proposal);
  if new.metadata->'amendment_context' is distinct from context or new.metadata->>'amendment_context_sha256' is distinct from public.canonical_json_sha256(context) then
   raise exception using errcode='23514',message='signed_amendment_request_context_invalid';end if;
 end if;
 if old.metadata?'amendment_context' then
  if tg_op='DELETE' then
   if exists(select from gridex_contract_amendment.acceptance_intents where request_id=old.id) then
    raise exception using errcode='55000',message='signed_amendment_accepted_request_immutable';end if;
   return old;
  end if;
  if new.company_id is distinct from old.company_id or new.customer_id is distinct from old.customer_id
   or new.customer_contract_id is distinct from old.customer_contract_id or new.token_hash is distinct from old.token_hash
   or new.created_by is distinct from old.created_by or new.recipient_email is distinct from old.recipient_email
   or new.metadata->'amendment_context' is distinct from old.metadata->'amendment_context'
   or new.metadata->>'amendment_context_sha256' is distinct from old.metadata->>'amendment_context_sha256' then
   raise exception using errcode='55000',message='signed_amendment_request_context_immutable';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
create trigger aa_signed_amendment_request_immutable before update or delete on public.customer_contract_signature_requests
for each row execute function gridex_contract_amendment.request_context_immutable_v1();

create function gridex_contract_amendment.physical_root_v1(c uuid,customer uuid,point uuid,candidate uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare current_id uuid:=candidate;seen uuid[]:=array[candidate];p gridex_contract_amendment.proposals%rowtype;proof jsonb;steps integer:=0;
begin
 if candidate is null or not exists(select from public.customer_contracts where id=candidate and company_id=c and customer_id=customer and metering_point_id=point) then
  raise exception using errcode='23514',message='signed_amendment_physical_root_scope_invalid';end if;
 loop
  select proposal.* into p from gridex_contract_amendment.proposals proposal
   join gridex_contract_amendment.acceptances accepted on accepted.proposal_id=proposal.id
   where proposal.company_id=c and proposal.successor_contract_id=current_id;
  if not found then return current_id;end if;
  steps:=steps+1;
  if steps>32 or p.predecessor_contract_id=any(seen) then raise exception using errcode='23514',message='signed_amendment_chain_invalid';end if;
  proof:=gridex_contract_amendment.verified_link_v1(p.id);
  if proof->>'customerId' is distinct from customer::text or proof->>'meteringPointId' is distinct from point::text then
   raise exception using errcode='23514',message='signed_amendment_chain_physical_scope_changed';end if;
  current_id:=p.predecessor_contract_id;seen:=array_append(seen,current_id);
 end loop;
end$$;

create function gridex_contract_amendment.proposal_guard_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare p gridex_contract_amendment.proposals%rowtype;i gridex_contract_amendment.acceptance_intents%rowtype;
 r public.customer_contract_signature_requests%rowtype;a gridex_contract_amendment.acceptances%rowtype;context jsonb;accepted_at timestamptz;
begin
 if tg_op='UPDATE' and exists(select from gridex_contract_amendment.proposals parent where parent.company_id=old.company_id
   and parent.predecessor_contract_id=old.id and parent.predecessor_terms is distinct from gridex_contract_amendment.terms_v1(to_jsonb(new))) then
  raise exception using errcode='55000',message='signed_amendment_predecessor_material_immutable';end if;
 select * into p from gridex_contract_amendment.proposals where successor_contract_id=old.id and company_id=old.company_id;
 if not found then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception using errcode='55000',message='signed_amendment_proposal_contract_delete_forbidden';end if;
 if gridex_contract_amendment.terms_v1(to_jsonb(new)) is distinct from p.successor_terms then
  raise exception using errcode='55000',message='signed_amendment_proposal_material_changed';end if;
 select * into a from gridex_contract_amendment.acceptances where proposal_id=p.id;
 if old.signed_at is not null and a.proposal_id is not null then
  if new.signature_snapshot is distinct from a.signature_snapshot or new.signature_snapshot_sha256 is distinct from a.signature_sha256
   or new.signed_at is distinct from a.accepted_at or new.locked_at is distinct from old.locked_at then
   raise exception using errcode='55000',message='signed_amendment_accepted_evidence_immutable';end if;
  return new;
 end if;
 if new.signed_at is null and new.locked_at is null and new.status not in('signed','active','terminated','expired') then return new;end if;
 -- A generic/imported/direct transition may already hold other row locks.
 -- Missing intent fails immediately: NEVER acquire a batch/parent/request lock.
 select * into i from gridex_contract_amendment.acceptance_intents where proposal_id=p.id and creating_txid=txid_current();
 if i.id is null or not i.explicit_customer_accepted then raise exception using errcode='55000',message='signed_amendment_explicit_customer_command_required';end if;
 select * into r from public.customer_contract_signature_requests where id=i.request_id and company_id=p.company_id and customer_id=p.customer_id and customer_contract_id=p.successor_contract_id;
 context:=gridex_contract_amendment.current_context_v1(p.id);
 if r.id is null or r.token_hash is distinct from i.token_hash or r.used_at is not null or r.revoked_at is not null
  or r.metadata->'amendment_context' is distinct from context or r.metadata->>'amendment_context_sha256' is distinct from i.context_sha256
  or i.context_sha256 is distinct from public.canonical_json_sha256(context)
  or new.status is distinct from 'signed' or new.signed_at is null or new.locked_at is distinct from new.signed_at
  or new.signature_snapshot->>'schema' is distinct from 'gridex_online_contract_signature_v2'
  or new.signature_snapshot->>'signature_request_id' is distinct from r.id::text
  or new.signature_snapshot->>'company_id' is distinct from p.company_id::text or new.signature_snapshot->>'customer_id' is distinct from p.customer_id::text
  or new.signature_snapshot->>'contract_id' is distinct from p.successor_contract_id::text
  or new.signature_snapshot->'amendment_context' is distinct from context
  or new.signature_snapshot->>'amendment_context_sha256' is distinct from i.context_sha256
  or new.signature_snapshot->>'pricing_snapshot_sha256' is distinct from p.successor_price_sha256
  or new.signature_snapshot_sha256 is distinct from public.canonical_json_sha256(new.signature_snapshot) then
  raise exception using errcode='55000',message='signed_amendment_customer_evidence_invalid';end if;
 accepted_at:=(new.signature_snapshot->>'accepted_at')::timestamptz;
 if accepted_at is distinct from new.signed_at or accepted_at<i.created_at or accepted_at>clock_timestamp() or r.expires_at<=accepted_at or r.expires_at<=clock_timestamp()
  or accepted_at>=(p.effective_from::timestamp at time zone 'Europe/Stockholm')
  or clock_timestamp()>=(p.effective_from::timestamp at time zone 'Europe/Stockholm') then
  raise exception using errcode='55000',message='signed_amendment_acceptance_not_future';end if;
 if not exists(select from public.customer_contract_evidence e where e.company_id=p.company_id and e.customer_contract_id=p.successor_contract_id
  and e.evidence_type='online_acceptance' and e.evidence_sha256=new.signature_snapshot_sha256 and e.evidence_snapshot=new.signature_snapshot) then
  raise exception using errcode='55000',message='signed_amendment_canonical_evidence_required';end if;
 -- Recheck at the actual transition, after ordinary evidence/FK callbacks
 -- may have waited; an earlier wrapper check cannot authorize a later write.
 perform gridex_contract_amendment.assert_staff_v1(p.company_id,p.actor_user_id);
 perform gridex_contract_amendment.assert_staff_v1(p.company_id,r.created_by);
 insert into gridex_contract_amendment.acceptances(proposal_id,signature_snapshot,signature_sha256,accepted_at,acceptance_context,acceptance_sha256)
 values(p.id,new.signature_snapshot,new.signature_snapshot_sha256,accepted_at,context,public.canonical_json_sha256(jsonb_build_object('context',context,'signatureSHA256',new.signature_snapshot_sha256,'acceptedAt',accepted_at)));
 return new;
end$$;
create trigger aa_signed_amendment_proposal_guard before update or delete on public.customer_contracts
for each row execute function gridex_contract_amendment.proposal_guard_v1();

create function public.gridex_finalize_customer_contract_amendment_signature_v1(
 p_token_hash text,p_amendment_context_sha256 text,p_amendment_accepted boolean,
 p_signed_ip_hash text default null,p_signed_user_agent text default null,p_signer_ip text default null,
 p_poa_accepted boolean default false,p_poa_scopes text[] default '{}',p_poa_terms_version text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare locator public.customer_contract_signature_requests%rowtype;r public.customer_contract_signature_requests%rowtype;
 p gridex_contract_amendment.proposals%rowtype;n public.customer_contracts%rowtype;a gridex_contract_amendment.acceptances%rowtype;
 context jsonb;hash text;root uuid;period_ids uuid[];assignment jsonb;result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='signed_amendment_service_required';end if;
 if p_amendment_accepted is distinct from true or coalesce(p_token_hash,'')!~'^[0-9a-f]{64}$' or coalesce(p_amendment_context_sha256,'')!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='signed_amendment_customer_consent_required';end if;
 select * into locator from public.customer_contract_signature_requests where token_hash=p_token_hash;
 select * into p from gridex_contract_amendment.proposals where company_id=locator.company_id and customer_id=locator.customer_id and successor_contract_id=locator.customer_contract_id;
 if locator.id is null or p.id is null then raise exception using errcode='23514',message='signed_amendment_request_scope_invalid';end if;
 context:=gridex_contract_amendment.context_v1(p.id);hash:=public.canonical_json_sha256(context);
 if p_amendment_context_sha256 is distinct from hash or locator.metadata->'amendment_context' is distinct from context
  or locator.metadata->>'amendment_context_sha256' is distinct from hash then
  raise exception using errcode='23514',message='signed_amendment_customer_context_mismatch';end if;
 if locator.used_at is not null then
  select * into a from gridex_contract_amendment.acceptances where proposal_id=p.id;
  select * into n from public.customer_contracts where id=p.successor_contract_id and company_id=p.company_id and customer_id=p.customer_id;
  if a.proposal_id is null or a.acceptance_context is distinct from context or a.accepted_at is distinct from locator.used_at
   or a.signature_snapshot is distinct from n.signature_snapshot or a.signature_sha256 is distinct from n.signature_snapshot_sha256
   or a.signature_sha256 is distinct from public.canonical_json_sha256(a.signature_snapshot)
   or a.signature_snapshot->>'signature_request_id' is distinct from locator.id::text then
   raise exception using errcode='23514',message='signed_amendment_historical_receipt_invalid';end if;
  -- A customer reads original evidence, not a new staff mutation/intent.
  return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash)||jsonb_build_object('already_signed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p.company_id::text||':billing-underlay-batch',0));
 perform gridex_bilateral_prodat.lock_supply_v1();perform gridex_regulated_supply.lock_graph_v1();
 perform id from public.companies where id=p.company_id for share;
 perform id from public.customer_contracts where company_id=p.company_id and id in(p.predecessor_contract_id,p.successor_contract_id) order by id for update;
 select * into r from public.customer_contract_signature_requests where id=locator.id for update;
 if r.used_at is not null then
  -- A concurrent successful signer won while this transaction waited. Re-enter
  -- only the immutable replay branch; no fresh eligibility/intent is created.
  return public.gridex_finalize_customer_contract_amendment_signature_v1(p_token_hash,p_amendment_context_sha256,p_amendment_accepted,
   p_signed_ip_hash,p_signed_user_agent,p_signer_ip,p_poa_accepted,p_poa_scopes,p_poa_terms_version);
 end if;
 if r.token_hash is distinct from p_token_hash or r.company_id is distinct from p.company_id or r.customer_id is distinct from p.customer_id
  or r.customer_contract_id is distinct from p.successor_contract_id or r.revoked_at is not null or r.expires_at<=clock_timestamp() then
  raise exception using errcode='23514',message='signed_amendment_request_not_current';end if;
 perform gridex_contract_amendment.assert_staff_v1(p.company_id,p.actor_user_id);
 perform gridex_contract_amendment.assert_staff_v1(p.company_id,r.created_by);
 context:=gridex_contract_amendment.current_context_v1(p.id);
 if context is distinct from r.metadata->'amendment_context' or hash is distinct from public.canonical_json_sha256(context)
  or p.effective_from<=(clock_timestamp() at time zone 'Europe/Stockholm')::date then
  raise exception using errcode='23514',message='signed_amendment_future_context_required';end if;
 if gridex_contract_amendment.has_competing_proposal_v1(p.company_id,p.predecessor_contract_id,p.id,(clock_timestamp() at time zone 'Europe/Stockholm')::date) then
  raise exception using errcode='23514',message='signed_amendment_active_proposal_exists';end if;
 select * into n from public.customer_contracts where id=p.predecessor_contract_id and company_id=p.company_id;
 root:=gridex_contract_amendment.physical_root_v1(p.company_id,p.customer_id,n.metering_point_id,n.id);
 select array_agg(sp.id) into period_ids from public.customer_supply_periods sp where sp.company_id=p.company_id and sp.customer_id=p.customer_id
  and sp.metering_point_id=n.metering_point_id and sp.contract_id=root and sp.status='active'
  and sp.start_date<=p.effective_from and (sp.end_date is null or sp.end_date>=p.effective_from);
 if cardinality(period_ids) is distinct from 1 then raise exception using errcode='23514',message='signed_amendment_physical_supply_required';end if;
 assignment:=public.gridex_read_contract_commercial_segments_v1(p.company_id,period_ids[1],p.effective_from::timestamp at time zone 'Europe/Stockholm',
  (p.effective_from::timestamp at time zone 'Europe/Stockholm')+interval '15 minutes');
 if jsonb_array_length(assignment->'segments')<>1 or assignment#>>'{segments,0,contractId}' is distinct from p.predecessor_contract_id::text then
  raise exception using errcode='23514',message='signed_amendment_predecessor_not_current';end if;
 if exists(select from public.billing_underlays u join gridex_billing_source.underlay_bindings b on b.underlay_id=u.id
  where u.company_id=p.company_id and u.customer_id=p.customer_id and u.metering_point_id=n.metering_point_id and u.billing_period_end>p.effective_from) then
  raise exception using errcode='23514',message='signed_amendment_finalized_billing_overlap';end if;
 -- All blocking source/contract/request locks precede final consent freshness.
 perform gridex_contract_amendment.assert_staff_v1(p.company_id,p.actor_user_id);
 if clock_timestamp()>=(p.effective_from::timestamp at time zone 'Europe/Stockholm') or r.expires_at<=clock_timestamp() then
  raise exception using errcode='23514',message='signed_amendment_future_context_required';end if;
 insert into gridex_contract_amendment.acceptance_intents(proposal_id,request_id,token_hash,context_sha256,explicit_customer_accepted,creating_txid)
 values(p.id,r.id,p_token_hash,hash,true,txid_current());
 result:=public.gridex_finalize_customer_contract_signature_v2(p_token_hash,p_signed_ip_hash,p_signed_user_agent,p_signer_ip,p_poa_accepted,p_poa_scopes,p_poa_terms_version);
 perform gridex_contract_amendment.verified_link_v1(p.id);
 return result;
end$$;

create function gridex_contract_amendment.reject_commercial_supply_v1(c uuid,contract_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if exists(select from gridex_contract_amendment.proposals where company_id=c and successor_contract_id=contract_id) then
  raise exception using errcode='23514',message='commercial_amendment_is_not_new_supply';end if;
end$$;
create function gridex_contract_amendment.guard_supply_entry_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare key text;candidate text;row_json jsonb:=to_jsonb(new);
begin
 if tg_table_name='customer_operation_jobs' and row_json->>'job_type' not in('start_supplier_switch','recheck_switch_readiness') then return new;end if;
 foreach key in array array['contract_id','customer_contract_id'] loop
  foreach candidate in array array[row_json->>key,row_json#>>array['metadata',key],row_json#>>array['payload',key]] loop
   if nullif(candidate,'') is not null then perform gridex_contract_amendment.reject_commercial_supply_v1(new.company_id,candidate::uuid);end if;
  end loop;
 end loop;
 return new;
end$$;
create trigger aa_commercial_amendment_no_physical_job before insert or update on public.customer_operation_jobs
for each row execute function gridex_contract_amendment.guard_supply_entry_v1();
create trigger aa_commercial_amendment_no_physical_request before insert or update on public.supplier_switch_requests
for each row execute function gridex_contract_amendment.guard_supply_entry_v1();
revoke all on all functions in schema gridex_contract_amendment from public,anon,authenticated,service_role;
revoke all on function public.gridex_finalize_customer_contract_amendment_signature_v1(text,text,boolean,text,text,text,boolean,text[],text) from public,anon,authenticated;
grant execute on function public.gridex_finalize_customer_contract_amendment_signature_v1(text,text,boolean,text,text,text,boolean,text[],text) to service_role;




-- Routing checks read immutable identity only. In particular, an unwrapped
-- request must fail BEFORE taking company/contract/request locks; it must not
-- invert the amendment wrapper's billing/source graph lock order.
create function gridex_contract_amendment.require_signature_route_v1(token text,allow_v2 boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.customer_contract_signature_requests%rowtype;p gridex_contract_amendment.proposals%rowtype;
begin
 select * into r from public.customer_contract_signature_requests where token_hash=token;
 select * into p from gridex_contract_amendment.proposals where company_id=r.company_id and successor_contract_id=r.customer_contract_id;
 if p.id is null then return;end if;
 if not allow_v2 or not exists(select from gridex_contract_amendment.acceptance_intents i
   where i.proposal_id=p.id and i.request_id=r.id and i.token_hash=token
   and i.creating_txid=txid_current() and i.explicit_customer_accepted
   and i.context_sha256=r.metadata->>'amendment_context_sha256') then
  raise exception using errcode='55000',message='signed_amendment_explicit_customer_route_required';end if;
end$$;
create function gridex_contract_amendment.require_ordinary_signature_v1(c uuid,contract_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if exists(select from gridex_contract_amendment.proposals where company_id=c and successor_contract_id=contract_id) then
  raise exception using errcode='55000',message='signed_amendment_explicit_customer_route_required';end if;
end$$;
revoke all on function gridex_contract_amendment.require_signature_route_v1(text,boolean),
 gridex_contract_amendment.require_ordinary_signature_v1(uuid,uuid) from public,anon,authenticated,service_role;

-- One authoritative half-open commercial assignment, independently required by
-- native consumers. Physical supply and its source payload retain their IDs.
create function gridex_contract_amendment.single_assignment_v1(c uuid,period_id uuid,start_at timestamptz,end_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare assignment jsonb;
begin
 assignment:=public.gridex_read_contract_commercial_segments_v1(c,period_id,start_at,end_at);
 if assignment is null or jsonb_array_length(assignment->'segments') is distinct from 1 then
  raise exception using errcode='23514',message='signed_amendment_single_commercial_segment_required';end if;
 return assignment;
end$$;
create function gridex_contract_amendment.commercial_binding_v1(c uuid,period_id uuid,start_at timestamptz,end_at timestamptz,contract_id uuid,price_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare assignment jsonb;segment jsonb;
begin
 assignment:=gridex_contract_amendment.single_assignment_v1(c,period_id,start_at,end_at);segment:=assignment#>'{segments,0}';
 if contract_id is null or segment->>'contractId' is distinct from contract_id::text
  or (segment->>'priceSnapshotId' is not null and segment->>'priceSnapshotId' is distinct from price_id::text) then
  raise exception using errcode='23514',message='signed_amendment_commercial_contract_price_mismatch';end if;
 -- Preserve byte-identical historical legacy source hashes: no new null key,
 -- no rewritten physical source/ground and no invented legacy CPS selector.
 if segment->>'contractId'=assignment->>'physicalContractId' then return null;end if;
 return assignment;
end$$;
revoke all on function gridex_contract_amendment.single_assignment_v1(uuid,uuid,timestamptz,timestamptz),
 gridex_contract_amendment.commercial_binding_v1(uuid,uuid,timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated,service_role;

-- Metering-request resolution is a read of signed commercial requirements, not
-- a grant to bill or a fabricated supply. Ordinary pre-supply drafts retain
-- their existing path; registered amendment drafts never become current terms.
create function public.gridex_read_contract_amendment_choices_v1(p_company_id uuid,p_metering_point_ids uuid[],p_on_date date) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare excluded jsonb;choices jsonb:='[]';candidate record;selected uuid;price_id uuid;price_sha text;
 p gridex_contract_amendment.proposals%rowtype;seen uuid[];steps integer;previous_day date;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='signed_amendment_service_required';end if;
 if p_company_id is null or p_on_date is null or not isfinite(p_on_date) or p_metering_point_ids is null
  or cardinality(p_metering_point_ids) not between 1 and 500 or array_position(p_metering_point_ids,null) is not null
  or (select count(distinct id) from unnest(p_metering_point_ids) id)<>cardinality(p_metering_point_ids)
  or exists(select from unnest(p_metering_point_ids) requested(point_id) where not exists(select from public.metering_points mp where mp.company_id=p_company_id and mp.id=requested.point_id)) then
  raise exception using errcode='23514',message='signed_amendment_metering_choice_scope_invalid';end if;
 select coalesce(jsonb_agg(entry.successor_contract_id order by entry.successor_contract_id),'[]') into excluded
 from gridex_contract_amendment.proposals entry join public.customer_contracts ct on ct.id=entry.successor_contract_id and ct.company_id=entry.company_id
 where entry.company_id=p_company_id and ct.metering_point_id=any(p_metering_point_ids);
 for candidate in select distinct ct.metering_point_id,gridex_contract_amendment.physical_root_v1(entry.company_id,entry.customer_id,ct.metering_point_id,entry.successor_contract_id) root_id
  from gridex_contract_amendment.proposals entry join gridex_contract_amendment.acceptances a on a.proposal_id=entry.id
  join public.customer_contracts ct on ct.id=entry.successor_contract_id and ct.company_id=entry.company_id
  where entry.company_id=p_company_id and ct.metering_point_id=any(p_metering_point_ids) loop
  selected:=candidate.root_id;price_id:=null;price_sha:=null;seen:=array[selected];steps:=0;previous_day:='-infinity';
  loop
   select proposal.* into p from gridex_contract_amendment.proposals proposal join gridex_contract_amendment.acceptances a on a.proposal_id=proposal.id
    where proposal.company_id=p_company_id and proposal.predecessor_contract_id=selected;
   if not found then exit;end if;
   if p.effective_from<=previous_day or p.successor_contract_id=any(seen) or steps>=32 then raise exception using errcode='23514',message='signed_amendment_metering_choice_chain_invalid';end if;
   if p.effective_from>p_on_date then exit;end if;
   perform gridex_contract_amendment.verified_link_v1(p.id);
   selected:=p.successor_contract_id;price_id:=p.successor_price_snapshot_id;price_sha:=p.successor_price_sha256;
   seen:=seen||selected;steps:=steps+1;previous_day:=p.effective_from;
  end loop;
  choices:=choices||jsonb_build_array(jsonb_build_object('meteringPointId',candidate.metering_point_id,
   'rootContractId',candidate.root_id,'contractId',selected,'priceSnapshotId',price_id,'priceSHA256',price_sha));
 end loop;
 return jsonb_build_object('schema','gridex-contract-amendment-metering-choices-v1','companyId',p_company_id,
  'onDate',p_on_date,'excludedAmendmentContractIds',excluded,'choices',choices);
end$$;
revoke all on function public.gridex_read_contract_amendment_choices_v1(uuid,uuid[],date) from public,anon,authenticated;
grant execute on function public.gridex_read_contract_amendment_choices_v1(uuid,uuid[],date) to service_role;

-- BEGIN GUARDED EXISTING NATIVE COUPLING
create function gridex_contract_amendment.patch_original_v1(signature text,expected_sha text,changes jsonb) returns void
language plpgsql set search_path=pg_catalog as $patch$
declare target oid:=to_regprocedure(signature);prior jsonb;current_profile jsonb;body text;definition text;change jsonb;needle text;
begin
 if target is null then raise exception 'signed_amendment_native_original_missing: %',signature;end if;
 select to_jsonb(p),p.prosrc into prior,body from pg_proc p where p.oid=target;
 if encode(sha256(convert_to(body,'UTF8')),'hex')<>all(string_to_array(expected_sha,'|')) then
  raise exception 'signed_amendment_native_original_drift: %',signature;end if;
 definition:=pg_get_functiondef(target);
 if length(definition)-length(replace(definition,body,''))<>length(body) then
  raise exception 'signed_amendment_native_body_not_unique: %',signature;end if;
 for change in select value from jsonb_array_elements(changes) loop
  needle:=change->>0;
  if length(body)-length(replace(body,needle,''))<>length(needle) then
   raise exception 'signed_amendment_native_anchor_not_unique: %',signature;end if;
  body:=replace(body,needle,change->>1);
 end loop;
 definition:=replace(definition,prior->>'prosrc',body);
 execute definition;
 select to_jsonb(p) into current_profile from pg_proc p where p.oid=target;
 if (current_profile-'prosrc') is distinct from (prior-'prosrc') or current_profile->>'prosrc' is distinct from body then
  raise exception 'signed_amendment_native_profile_changed: %',signature;end if;
end$patch$;
revoke all on function gridex_contract_amendment.patch_original_v1(text,text,jsonb) from public,anon,authenticated,service_role;
select gridex_contract_amendment.patch_original_v1('public.gridex_finalize_customer_contract_signature_v1(text,text,text)','781d8eaf41dc87ebdc45d07e3c4235c2b0fa2fdb990e63cb65f4773b726a2e42',$changes$[["  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'", "  perform gridex_contract_amendment.require_signature_route_v1(p_token_hash,false);\n  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_finalize_customer_contract_signature_v2(text,text,text,text,boolean,text[],text)','f1c05963dcec01314b423bfc12828deee36cf1d10af3780cf18017447730ca93',$changes$[["  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'", "  perform gridex_contract_amendment.require_signature_route_v1(p_token_hash,true);\n  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'"], ["  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');", "  -- The exact customer-visible amendment context is part of the ORIGINAL\n  -- signature and every ordinary downstream acceptance/evidence hash.\n  if v_request.metadata?'amendment_context' then\n    perform gridex_contract_amendment.require_signature_route_v1(p_token_hash,true);\n    v_signature:=v_signature||jsonb_build_object(\n      'amendment_context',v_request.metadata->'amendment_context',\n      'amendment_context_sha256',v_request.metadata->>'amendment_context_sha256');\n  end if;\n  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_finalize_signature_before_record_retention_v1(text,text,text)','d42ec0882fe95359caea524902da4da2f9629ca17c18c85c88431e9bf679c04a',$changes$[["  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'", "  perform gridex_contract_amendment.require_signature_route_v1(p_token_hash,false);\n  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_get_customer_contract_signature_receipt_v1(text)','55345d704b4dabcc3e06349335f646e4e6936fc9733758e02686db15d833a29f',$changes$[["    'signature_snapshot_sha256',v_contract.signature_snapshot_sha256\n  );", "    'signature_snapshot_sha256',v_contract.signature_snapshot_sha256\n  ) || case when v_request.metadata?'amendment_context' then jsonb_build_object(\n    'amendment_context',v_request.metadata->'amendment_context',\n    'amendment_context_sha256',v_request.metadata->>'amendment_context_sha256') else '{}'::jsonb end;"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_enqueue_signed_contract_operation_v1()','26ef56785c24e3268ab10ad5ae31b5655a1522d5353462d55ba7f1c52aa8914c',$changes$[["  -- Never trust a relational site ID until it resolves inside exact tenant and", "  -- Acceptance is sealed by the BEFORE update guard. Validate that actual\n  -- immutable edge again before suppressing ONLY a new physical supply job.\n  if exists(select from gridex_contract_amendment.proposals p\n    where p.company_id=new.company_id and p.successor_contract_id=new.id) then\n    perform gridex_contract_amendment.verified_link_v1(p.id)\n      from gridex_contract_amendment.proposals p\n      where p.company_id=new.company_id and p.successor_contract_id=new.id;\n    return new;\n  end if;\n\n  -- Never trust a relational site ID until it resolves inside exact tenant and"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_finalize_admin_imported_signed_agreement_v1()','f9d650c03e77ecba814a712921e200a92f3ef8e22d49fce44e184958de740401',$changes$[["  if new.company_id is null", "  perform gridex_contract_amendment.require_ordinary_signature_v1(new.company_id,new.customer_contract_id);\n\n  if new.company_id is null"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,text,text,text)','25fa36d4aa0f57230aa231db7186ec94d0619bfe420626483ba076bda7fd9794',$changes$[["begin\n", "begin\n  perform gridex_contract_amendment.require_ordinary_signature_v1(p_company_id,p_contract_id);\n"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,jsonb,text,text,text)','1c58eb222614ad7f11c7ef7ba27c203b8cd5376ee13dfde9e35b4c507637c3d4',$changes$[["begin\n", "begin\n  perform gridex_contract_amendment.require_ordinary_signature_v1(p_company_id,p_contract_id);\n"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('gridex_regulated_supply.scope_v1(uuid,jsonb)','1fb428405c318e5b66ea7a9a079ebe9e6da5031898f1d5a85eba159457d4e423',$changes$[[" IF (SELECT count(*) FROM public.metering_points owned", " IF gridex_contract_amendment.physical_root_v1(c,customer.id,point.id,contract.id) IS DISTINCT FROM contract.id THEN RETURN NULL;END IF;\n IF (SELECT count(*) FROM public.metering_points owned"], ["owned.status IN('signed','active') AND owned.signed_version=owned.contract_version)<>1", "owned.status IN('signed','active') AND owned.signed_version=owned.contract_version AND gridex_contract_amendment.physical_root_v1(c,customer.id,point.id,owned.id)=owned.id)<>1"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_assert_supplier_switch_ready(uuid,uuid)','cdd415230775cc2fad33c53a07abadacb9879d9c7336267e1fa661da70748099',$changes$[["begin\n", "begin\n  perform gridex_contract_amendment.reject_commercial_supply_v1(p_company_id,p_contract_id);\n"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_create_supplier_switch_v1(uuid,jsonb,jsonb)','23fb8fcc719ee953c05dec55cef08b41408ed361d58d0ba28c0b8bbf30e95073',$changes$[["  perform public.gridex_assert_switch_writer_v1(p_company_id);", "  perform public.gridex_assert_switch_writer_v1(p_company_id);\n  perform gridex_contract_amendment.reject_commercial_supply_v1(p_company_id,nullif(p_request->>'contract_id','')::uuid);\n  perform gridex_contract_amendment.reject_commercial_supply_v1(p_company_id,nullif(p_request->>'customer_contract_id','')::uuid);\n  perform gridex_contract_amendment.reject_commercial_supply_v1(p_company_id,nullif(p_request#>>'{metadata,contract_id}','')::uuid);"]]$changes$::jsonb);
-- BEGIN GUARDED COMMERCIAL BILLING COUPLING
select gridex_contract_amendment.patch_original_v1('public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)','6436365140840667c35faa1414bff1cff0540ee80b8bc2e21ef092763b70b1be',$changes$[["DECLARE b jsonb;legal_basis jsonb;", "DECLARE b jsonb;legal_basis jsonb;commercial_assignment jsonb;commercial_binding jsonb;"], [" PERFORM gridex_billing_source.lock_values_v1", " PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();\n PERFORM gridex_billing_source.lock_values_v1"], ["  SELECT * INTO ct FROM public.customer_contracts WHERE id=sp.contract_id AND company_id=p_company_id FOR SHARE;", "  commercial_assignment:=gridex_contract_amendment.single_assignment_v1(p_company_id,sp.id,n.period_start,n.period_end);\n  SELECT * INTO ct FROM public.customer_contracts WHERE id=(commercial_assignment#>>'{segments,0,contractId}')::uuid AND company_id=p_company_id FOR SHARE;\n  commercial_binding:=gridex_contract_amendment.commercial_binding_v1(p_company_id,sp.id,n.period_start,n.period_end,ct.id,ct.contract_price_snapshot_id);\n  IF p_gate#>>'{billing_gate_snapshot,contract_id}' IS DISTINCT FROM ct.id::text OR (commercial_binding IS NOT NULL AND p_gate#>'{billing_gate_snapshot,commercial_assignment}' IS DISTINCT FROM commercial_binding) THEN RAISE EXCEPTION 'billing_gate_commercial_assignment_mismatch' USING ERRCODE='23514';END IF;"], ["  p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',coalesce(p_gate->'billing_gate_snapshot','{}')||jsonb_build_object('source_basis',b,'supply_source_basis',legal_basis));", "  p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',coalesce(p_gate->'billing_gate_snapshot','{}')||jsonb_build_object('source_basis',b,'supply_source_basis',legal_basis));\n  IF commercial_binding IS NOT NULL THEN p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',(p_gate->'billing_gate_snapshot')||jsonb_build_object('commercial_assignment',commercial_binding));END IF;"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)','c775d57fec0c980ddc31fff632b3595971250071d54fe2be76ff65b6eb3217a3',$changes$[["DECLARE item jsonb;basis jsonb;", "DECLARE commercial_binding jsonb;item jsonb;basis jsonb;"], [" PERFORM gridex_billing_source.lock_values_v1", " PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();\n PERFORM gridex_billing_source.lock_values_v1"], [" OR sp.contract_id IS DISTINCT FROM ct.id OR sp.customer_id", " OR gridex_contract_amendment.physical_root_v1(p_company_id,ct.customer_id,ct.metering_point_id,ct.id) IS DISTINCT FROM sp.contract_id OR sp.customer_id"], [" legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,start_at,end_at);", " commercial_binding:=gridex_contract_amendment.commercial_binding_v1(p_company_id,sp.id,start_at,end_at,ct.id,price.id);\n legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,start_at,end_at);"], [" basis_hash:=encode(extensions.digest(convert_to(source_basis::text,'UTF8'),'sha256'),'hex');", " IF commercial_binding IS NOT NULL THEN source_basis:=source_basis||jsonb_build_object('commercialAssignment',commercial_binding);END IF;\n basis_hash:=encode(extensions.digest(convert_to(source_basis::text,'UTF8'),'sha256'),'hex');"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('gridex_billing_source.require_underlay_v1(uuid,uuid)','eba7ec8c7aa4fc09796b338fa4470bc243d9891507dbc71b036c3ee4569cf362',$changes$[["b gridex_billing_source.underlay_bindings%rowtype;legal_basis jsonb;", "b gridex_billing_source.underlay_bindings%rowtype;legal_basis jsonb;commercial_binding jsonb;"], [" IF legal_basis IS DISTINCT FROM b.source_basis->'supply' THEN RAISE EXCEPTION 'billing_finalized_supply_basis_changed' USING ERRCODE='23514'; END IF;", " IF legal_basis IS DISTINCT FROM b.source_basis->'supply' THEN RAISE EXCEPTION 'billing_finalized_supply_basis_changed' USING ERRCODE='23514'; END IF;\n commercial_binding:=gridex_contract_amendment.commercial_binding_v1(p_company,u.supply_period_id,(b.source_basis->>'start')::timestamptz,(b.source_basis->>'end')::timestamptz,u.contract_id,coalesce(u.contract_price_snapshot_id,u.pricing_snapshot_id));\n IF commercial_binding IS DISTINCT FROM b.source_basis->'commercialAssignment' THEN RAISE EXCEPTION 'billing_finalized_commercial_assignment_changed' USING ERRCODE='23514';END IF;"]]$changes$::jsonb);
-- Exact reviewed donor 19f82746d / 20261101212734 may precede this migration.
-- Only its pinned prosrc and unchanged exact anchors join actual main here.
select gridex_contract_amendment.patch_original_v1('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)','bce60486b4f1c94253d9ce4a444f6277babcbfb3ed106815aff8299f6dd96c95|0b196e776dc3c83b4edba4172ce3f0399f93eb50f09c43717f6e4d645c02a11b',$changes$[["  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0));", "  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));\n PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();\n  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0));"], ["  v_source_bound:=EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.company_id=p_company_id AND b.underlay_id=p_billing_underlay_id);", "  v_source_bound:=EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.company_id=p_company_id AND b.underlay_id=p_billing_underlay_id);\n  IF v_source_bound THEN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,p_billing_underlay_id);END IF;"]]$changes$::jsonb);
select gridex_contract_amendment.patch_original_v1('public.gridex_lock_pricing_run(uuid,uuid,uuid)','2dbef106cb33170ec4490bba75164b479a26a24df9264162c3f368089eba4a08',$changes$[["  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_pricing_run_id::text,0));", "  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));\n PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();\n  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_pricing_run_id::text,0));"], ["  if not found then raise exception using errcode='P0002',message='pricing_underlay_not_found'; end if;", "  if not found then raise exception using errcode='P0002',message='pricing_underlay_not_found'; end if;\n  IF EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.company_id=p_company_id AND b.underlay_id=v_underlay.id) THEN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,v_underlay.id);END IF;"]]$changes$::jsonb);
drop function gridex_contract_amendment.patch_original_v1(text,text,jsonb);
commit;
