-- What the attendee screens need: vendor branding, product photos and descriptions,
-- a venue name, an optional floor plan image, order details with the booth and a
-- refund state, cancelling any attendee order, and opening an order from its emailed link.

-- Storage -------------------------------------------------------------------------
-- Images live in one public bucket. The columns below hold the path inside it, such as
-- 'vendors/moon-ceramics/logo.png'. The path is the same on every project, unlike a full
-- address, so the API layer builds the public URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assets', 'assets', true, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;
-- Public buckets serve their files without a policy. There is no write policy, so only
-- the service role and the dashboard can upload.

-- Branding, photos and venue ----------------------------------------------------------
-- Added as optional, filled for any existing row, then made required.

alter table public.vendors
  add column logo_path text,
  add column slogan text,
  add column banner_path text;
update public.vendors set
  logo_path = coalesce(logo_path, 'placeholders/logo.svg'),
  slogan = coalesce(slogan, name),
  banner_path = coalesce(banner_path, 'placeholders/banner.svg');
alter table public.vendors
  alter column logo_path set not null,
  alter column slogan set not null,
  alter column banner_path set not null,
  add constraint vendors_logo_path_not_blank check (btrim(logo_path) <> ''),
  add constraint vendors_slogan_not_blank check (btrim(slogan) <> ''),
  add constraint vendors_banner_path_not_blank check (btrim(banner_path) <> '');

alter table public.products
  add column image_path text,
  add column description text;
update public.products set
  image_path = coalesce(image_path, 'placeholders/product.svg'),
  description = coalesce(description, name);
alter table public.products
  alter column image_path set not null,
  alter column description set not null,
  add constraint products_image_path_not_blank check (btrim(image_path) <> ''),
  add constraint products_description_not_blank check (btrim(description) <> '');

alter table public.events add column venue_name text;
update public.events set venue_name = coalesce(venue_name, name);
alter table public.events
  alter column venue_name set not null,
  add constraint events_venue_name_not_blank check (btrim(venue_name) <> ''),
  -- The map image is the only optional part: the hall may be drawn in the app instead.
  alter column floor_plan_url drop not null;

-- Orders for the attendee screens -------------------------------------------------------

-- One flat row per order with its event, booth, and whether a refund is owed. It carries
-- no email address and no private link token. It runs with the caller's rights, so the
-- access rules on orders and payments apply: attendees see their own orders, staff see
-- their booth's.
create view public.order_details
with (security_invoker = true) as
select
  o.id,
  o.booth_id,
  b.event_id,
  b.code as booth_code,
  v.name as booth_name,
  o.type,
  o.status,
  o.total_cents,
  o.currency,
  o.pickup_code,
  o.hold_ends_at,
  o.created_at,
  o.collected_at,
  o.cancel_reason,
  -- Refund state of the order, read from its payments: owed, else refunded, else none.
  coalesce((
    select (case
      when bool_or(p.refund_status = 'due') then 'due'
      when bool_or(p.refund_status = 'refunded') then 'refunded'
      else 'none'
    end)::public.refund_status
    from public.payments p
    where p.order_id = o.id
  ), 'none'::public.refund_status) as refund_status
from public.orders o
join public.booths b on b.id = o.booth_id
join public.vendors v on v.id = b.vendor_id;

revoke all on public.order_details from anon, authenticated;
grant select on public.order_details to authenticated;

-- The order as an attendee sees it. No email, no private token, no provider ids.
create function private.attendee_order_payload(p_order_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'orderId', d.id,
    'boothId', d.booth_id,
    'eventId', d.event_id,
    'boothCode', d.booth_code,
    'boothName', d.booth_name,
    'type', d.type,
    'status', d.status,
    'pickupCode', d.pickup_code,
    'holdEndsAt', d.hold_ends_at,
    'totalCents', d.total_cents,
    'currency', d.currency,
    'collectedAt', d.collected_at,
    'cancelReason', d.cancel_reason,
    'refundStatus', d.refund_status,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'productId', i.product_id,
          'name', i.name,
          'quantity', i.quantity,
          'unitPriceCents', i.unit_price_cents
        )
        order by i.name
      )
      from public.order_items i
      where i.order_id = d.id
    ), '[]'::jsonb)
  )
  from public.order_details d
  where d.id = p_order_id;
$$;

-- The order result now also names its booth, event and refund state.
create or replace function private.order_payload(p_order_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.attendee_order_payload(o.id) || jsonb_build_object(
    'buyerEmail', o.email,
    'checkoutLinkId', o.checkout_link_id,
    'providerOrderId', o.provider_order_id
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- Opens one order from the private link in its confirmation email, on any device, with no
-- session. The token is a long random secret, so it is the only credential. The answer is
-- the same for a token that does not exist, so a guess learns nothing.
create function public.get_order_by_token(p_token uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id from public.orders where private_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  return private.attendee_order_payload(v_order_id);
end;
$$;

-- Cancelling ----------------------------------------------------------------------------

-- Replaces cancel_reservation, which only handled unpaid reservations.
drop function public.cancel_reservation(uuid);

-- An attendee cancels their own order, unpaid or prepaid, while it is confirmed or ready.
-- The stock returns. A paid order's payment becomes refund due; the vendor refunds it in
-- Square and the webhook then marks it refunded.
create function public.cancel_my_order(p_order_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and user_id = auth.uid()
  for update;
  -- An order that is not theirs looks the same as one that does not exist.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_order.status not in ('confirmed', 'ready') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed_in_status', 'status', v_order.status);
  end if;

  perform private.release_stock(p_order_id);
  update public.orders set status = 'cancelled', cancel_reason = 'Cancelled by the attendee' where id = p_order_id;
  if v_order.type = 'prepaid' then
    update public.payments set refund_status = 'due' where order_id = p_order_id and refund_status = 'none';
  end if;
  return private.order_payload(p_order_id);
end;
$$;

-- Access --------------------------------------------------------------------------------

revoke execute on function public.cancel_my_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_my_order(uuid) to authenticated;

revoke execute on function public.get_order_by_token(uuid) from public, anon, authenticated;
grant execute on function public.get_order_by_token(uuid) to anon, authenticated;
