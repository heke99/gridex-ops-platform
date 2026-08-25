alter table public.customer_site_resolution
  drop constraint if exists customer_site_resolution_price_area_assurance_source_check;

alter table public.customer_site_resolution
  add constraint customer_site_resolution_price_area_assurance_source_check
  check (
    price_area_assurance_source is null
    or price_area_assurance_source = any (
      array[
        'facility_data'::text,
        'grid_area_master'::text,
        'address_polygon'::text,
        'postal_city_consensus'::text,
        'postal_consensus'::text,
        'postal_centroid'::text
      ]
    )
  );
