-- Table privileges, stated outright. Older Supabase projects grant new tables to the API
-- roles automatically, and newer ones grant nothing, so the earlier migrations worked
-- only on the first kind. This resets the three API roles to exactly what the app needs,
-- on either kind. Row-level security still decides which rows each role may read.

grant usage on schema public to anon, authenticated, service_role;

revoke all on all tables in schema public from anon, authenticated;

-- The catalog is readable by anyone.
grant select on public.events, public.vendors, public.booths, public.products to anon, authenticated;

-- Signed-in users read their own orders and, for staff, their booth's. Nothing is written
-- from the browser: writes go through database functions.
grant select on
  public.vendor_staff,
  public.orders,
  public.order_items,
  public.payments,
  public.order_details
to authenticated;

-- The service role is the Edge Functions and the tests. provider_connections and
-- payment_refunds are reachable only through it.
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
