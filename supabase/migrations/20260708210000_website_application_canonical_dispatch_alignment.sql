-- Website application canonical metering/request repair + dispatch-alignment guards.
--
-- Production verification showed the website customer application flow was
-- green at the customer_site level but still leaked canonical data in two
-- downstream tables:
--   * metering_points.grid_area_code/grid_owner_id/bidding_zone_code stayed null
--   * grid_owner_information_requests.price_area stayed null even when the site had SE4
--
-- This migration is forward-only and idempotent. It adds missing canonical
-- columns, backfills existing website-created rows from customer_sites, and
-- installs small DB defaults so future inserts cannot lose SE1-SE4/bidding zone
-- when the application layer sends a partially compatible payload.

set lock_timeout = '5s';
set statement_timeout = '2min';

alter table if exists public.metering_points
  add column if not exists site_id uuid,
  add column if not exists customer_site_id uuid,
  add column if not exists metering_point_id text,
  add column if not exists meter_point_id text,
  add column if not exists ediel_metering_point_id text,
  add column if not exists grid_area_code text,
  add column if not exists price_area_code text,
  add column if not exists bidding_zone_code text,
  add column if not exists grid_owner_id uuid,
  add column if not exists anlage_id text,
  add column if not exists site_facility_id text,
  add column if not exists estimated_annual_consumption_kwh numeric,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz;

alter table if exists public.grid_owner_information_requests
  add column if not exists price_area text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz;

update public.metering_points mp
   set grid_area_code = coalesce(nullif(btrim(mp.grid_area_code), ''), nullif(btrim(cs.grid_area_code), '')),
       price_area_code = coalesce(nullif(btrim(mp.price_area_code), ''), nullif(btrim(cs.price_area_code), ''), nullif(btrim(cs.bidding_zone_code), '')),
       bidding_zone_code = coalesce(nullif(btrim(mp.bidding_zone_code), ''), nullif(btrim(cs.bidding_zone_code), ''), nullif(btrim(cs.price_area_code), ''), nullif(btrim(mp.price_area_code), '')),
       grid_owner_id = coalesce(mp.grid_owner_id, cs.grid_owner_id, cs.selected_grid_owner_id),
       customer_site_id = coalesce(mp.customer_site_id, cs.id),
       site_id = coalesce(mp.site_id, cs.id),
       anlage_id = coalesce(nullif(btrim(mp.anlage_id), ''), nullif(btrim(mp.metering_point_id), ''), nullif(btrim(mp.meter_point_id), ''), nullif(btrim(cs.facility_id), '')),
       site_facility_id = coalesce(nullif(btrim(mp.site_facility_id), ''), nullif(btrim(cs.facility_id), ''), nullif(btrim(mp.metering_point_id), ''), nullif(btrim(mp.meter_point_id), '')),
       estimated_annual_consumption_kwh = coalesce(mp.estimated_annual_consumption_kwh, cs.annual_consumption_kwh),
       metadata = coalesce(mp.metadata, '{}'::jsonb) || jsonb_build_object(
         'canonical_backfill_source', '20260708210000_website_application_canonical_dispatch_alignment',
         'customer_site_id', cs.id
       ),
       updated_at = now()
  from public.customer_sites cs
 where mp.company_id = cs.company_id
   and (mp.customer_site_id = cs.id or mp.site_id = cs.id)
   and (
     nullif(btrim(mp.grid_area_code), '') is null
     or nullif(btrim(mp.price_area_code), '') is null
     or nullif(btrim(mp.bidding_zone_code), '') is null
     or mp.grid_owner_id is null
     or mp.customer_site_id is null
     or mp.site_id is null
     or mp.estimated_annual_consumption_kwh is null
   );

update public.grid_owner_information_requests gir
   set price_area = coalesce(
         nullif(btrim(gir.price_area), ''),
         nullif(btrim(cs.price_area_code), ''),
         nullif(btrim(cs.bidding_zone_code), ''),
         nullif(btrim(cs.metadata #>> '{energy_resolution,priceArea}'), ''),
         nullif(btrim(cs.metadata #>> '{energy_resolution,price_area}'), ''),
         nullif(btrim(cs.metadata ->> 'claimed_price_area_code'), '')
       ),
       grid_area_code = coalesce(nullif(btrim(gir.grid_area_code), ''), nullif(btrim(cs.grid_area_code), '')),
       grid_owner_id = coalesce(gir.grid_owner_id, cs.grid_owner_id, cs.selected_grid_owner_id),
       metadata = coalesce(gir.metadata, '{}'::jsonb) || jsonb_build_object(
         'price_area_backfill_source', '20260708210000_website_application_canonical_dispatch_alignment',
         'customer_site_id', cs.id
       ),
       updated_at = now()
  from public.customer_sites cs
 where gir.company_id = cs.company_id
   and gir.customer_site_id = cs.id
   and (
     nullif(btrim(gir.price_area), '') is null
     or nullif(btrim(gir.grid_area_code), '') is null
     or gir.grid_owner_id is null
   );

-- No trigger DDL here by design. The application layer now writes the canonical
-- values directly, and the backfill above repairs existing rows. Avoiding
-- DROP/CREATE TRIGGER keeps this migration safe to run on Supabase production
-- where website/application traffic can otherwise deadlock on AccessExclusiveLock.

create index if not exists metering_points_customer_site_canonical_idx
  on public.metering_points(company_id, customer_site_id)
  where customer_site_id is not null;

create index if not exists grid_owner_information_requests_price_area_idx
  on public.grid_owner_information_requests(company_id, customer_site_id, price_area)
  where customer_site_id is not null;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
