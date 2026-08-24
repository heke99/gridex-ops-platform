alter table public.platform_address_lookup_cache
  add column if not exists street_number text;

comment on column public.platform_address_lookup_cache.street_number is
'Exact delivery-point house number/suffix used to distinguish full-address geocoding from street/postal centroids.';
