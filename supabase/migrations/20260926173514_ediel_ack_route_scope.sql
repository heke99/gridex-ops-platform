-- The canonical ACK router selects communication_routes.route_scope='ediel_ack'.
-- The existing check omitted that value, so no tenant could persist a route
-- that the actual inbound ACK gateway would select. Widen only this enum-like
-- constraint; it does not create a route, mandate or transport authorization.
alter table public.communication_routes
  drop constraint communication_routes_route_scope_check;

alter table public.communication_routes
  add constraint communication_routes_route_scope_check
  check (route_scope in (
    'supplier_switch',
    'customer_masterdata',
    'meter_values',
    'metering_values',
    'billing_underlay',
    'metering_access',
    'ediel_ack'
  ));
