-- Synthetic production-sized data for performance measurement (stub schema).
-- One company, 5 000 customers / metering points (each with a supply period),
-- 1 000 points with hourly consumption for the last 12 full months (~8.8M rows).
\set ON_ERROR_STOP 1
insert into companies(id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Perf AB');
insert into customers(id, company_id, full_name)
select ('00000000-0000-0000-0001-' || lpad(to_hex(g), 12, '0'))::uuid, '00000000-0000-0000-0000-0000000000f1', 'Kund ' || g
from generate_series(1, 5000) g;
insert into metering_points(id, company_id, bidding_zone_code)
select ('00000000-0000-0000-0002-' || lpad(to_hex(g), 12, '0'))::uuid, '00000000-0000-0000-0000-0000000000f1', 'SE' || (1 + g % 4)
from generate_series(1, 5000) g;
insert into customer_supply_periods(company_id, customer_id, metering_point_id, start_date, end_date, status)
select '00000000-0000-0000-0000-0000000000f1',
       ('00000000-0000-0000-0001-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('00000000-0000-0000-0002-' || lpad(to_hex(g), 12, '0'))::uuid,
       (date '2024-01-01' + (g % 900)),
       case when g % 7 = 0 then date '2024-01-01' + (g % 900) + 200 end,
       case when g % 7 = 0 then 'ended' else 'active' end
from generate_series(1, 5000) g;
insert into powers_of_attorney(company_id, customer_id, status, signed_at, valid_to, created_at)
select '00000000-0000-0000-0000-0000000000f1', ('00000000-0000-0000-0001-' || lpad(to_hex(g), 12, '0'))::uuid,
       'signed', now() - (g % 400) * interval '1 day', current_date + (g % 400), now() - (g % 400) * interval '1 day'
from generate_series(1, 5000) g;
insert into grid_owner_data_requests(company_id, request_scope, status, requested_period_start, requested_at)
select '00000000-0000-0000-0000-0000000000f1', 'meter_values', 'sent', current_date - (g % 500), now() - (g % 365) * interval '1 day'
from generate_series(1, 10000) g;
insert into metering_values(company_id, metering_point_id, value_kwh, period_start)
select '00000000-0000-0000-0000-0000000000f1',
       ('00000000-0000-0000-0002-' || lpad(to_hex(p), 12, '0'))::uuid,
       0.5 + (p % 10) * 0.1, h
from generate_series(1, 1000) p,
     generate_series(date_trunc('month', now()) - interval '12 months', date_trunc('month', now()) - interval '1 hour', interval '1 hour') h;
create index if not exists mv_company_point_period on metering_values(company_id, metering_point_id, period_start);
create index if not exists mv_company_period on metering_values(company_id, period_start);
analyze;
