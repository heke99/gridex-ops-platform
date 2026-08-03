begin;

create table if not exists public.ops_publication_state (
  tenant_reference text not null,
  channel text not null,
  publication_revision bigint,
  revision_token text,
  delivery_id text,
  etag text,
  event_id text,
  event_timestamp timestamptz,
  publication_reason text,
  changed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_reference, channel)
);

alter table public.ops_publication_state enable row level security;
revoke all on public.ops_publication_state from public, anon, authenticated;
grant select, insert, update on public.ops_publication_state to service_role;

create index if not exists ops_publication_state_revision_idx
  on public.ops_publication_state (tenant_reference, channel, publication_revision desc nulls last);

create table if not exists public.website_public_contract_snapshots (
  cache_key text primary key,
  tenant_reference text not null,
  channel text not null default 'website' check (channel = 'website'),
  customer_type text not null check (customer_type in ('all', 'private', 'business')),
  publication_revision bigint not null check (publication_revision >= 0),
  contract_version text not null,
  parser_version text not null,
  schema_sha256 text not null,
  etag text,
  snapshot jsonb not null,
  accepted_count integer not null check (accepted_count >= 0),
  blocked_count integer not null check (blocked_count >= 0),
  upstream_count integer not null check (upstream_count >= 0),
  feed_state text not null,
  empty_feed_authorization jsonb,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_public_contract_snapshots_count_check
    check (upstream_count = accepted_count + blocked_count),
  constraint website_public_contract_snapshots_feed_state_check
    check (
      (
        feed_state = 'contracts_present'
        and accepted_count > 0
        and upstream_count > 0
        and empty_feed_authorization is null
      )
      or
      (
        feed_state = 'canonical_empty'
        and accepted_count = 0
        and blocked_count = 0
        and upstream_count = 0
        and jsonb_typeof(empty_feed_authorization) = 'object'
        and empty_feed_authorization -> 'authorized' = 'true'::jsonb
        and empty_feed_authorization ->> 'reason' in (
          'no_canonical_publications',
          'canonical_unpublished_or_archived',
          'publication_validity_ended',
          'canonical_no_visible_contracts'
        )
        and empty_feed_authorization -> 'publication_revision' = to_jsonb(publication_revision)
        and empty_feed_authorization ->> 'canonical_source' = 'canonical_public_contract_delivery_readiness_v'
        and jsonb_typeof(empty_feed_authorization -> 'affected_offer_references') = 'array'
        and jsonb_typeof(empty_feed_authorization -> 'blockers') = 'array'
      )
    )
);

create index if not exists website_public_contract_snapshots_tenant_lookup_idx
  on public.website_public_contract_snapshots (
    tenant_reference,
    channel,
    customer_type,
    publication_revision desc nulls last
  );

alter table public.website_public_contract_snapshots enable row level security;
revoke all on public.website_public_contract_snapshots from public, anon, authenticated;
grant select, insert, update on public.website_public_contract_snapshots to service_role;

comment on table public.website_public_contract_snapshots is
  'Tenant-bound durable last-known-good Gridex OPS website contract feed. Only service_role may read or mutate it.';

insert into public.ops_publication_state (
  tenant_reference,
  channel,
  publication_revision,
  revision_token,
  changed_at,
  updated_at
)
select
  c.external_tenant_reference,
  r.channel,
  r.revision,
  r.revision_token::text,
  r.updated_at,
  now()
from public.contract_publication_revisions r
join public.companies c on c.id = r.company_id
where nullif(trim(c.external_tenant_reference), '') is not null
on conflict (tenant_reference, channel)
do update set
  publication_revision = excluded.publication_revision,
  revision_token = excluded.revision_token,
  changed_at = excluded.changed_at,
  updated_at = now()
where public.ops_publication_state.publication_revision is null
   or excluded.publication_revision >= public.ops_publication_state.publication_revision;

commit;
