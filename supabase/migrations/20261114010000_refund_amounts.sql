-- Records how much each Square refund was for, and shows the refunded total on the order.
-- A refund may be partial. Any completed refund still marks its payment refunded, and the
-- amounts say how much has actually gone back.

-- Each refund carries its amount. The table is empty on every project this runs on, so the
-- new column can be required straight away.
alter table public.payment_refunds
  add column amount_cents integer not null,
  add constraint payment_refunds_amount_positive check (amount_cents > 0);

-- order_details runs with the caller's rights, and it now reads payment_refunds, so signed-in
-- users need to be able to read it: the same people who can read the payment it belongs to.
grant select on public.payment_refunds to authenticated;
create policy payment_refunds_read on public.payment_refunds
  for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_refunds.payment_id));

-- Replaces the version without an amount. The Edge Function passes the refund's amount and
-- currency as Square reports them.
drop function public.svc_mark_refunded(text, text);

-- A completed Square refund marks its payment refunded, partial or not, and whether or not
-- the payment was refund due. The refund id makes a repeated message a no-op, and the amount
-- is stored with the refund. The refund must be in the payment's currency.
create function public.svc_mark_refunded(
  p_provider_payment_id text,
  p_provider_refund_id text,
  p_amount_cents integer,
  p_currency text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_currency text;
  v_inserted integer;
begin
  perform private.require_service_role();
  if p_provider_refund_id is null or btrim(p_provider_refund_id) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_refund_id');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  select id, currency into v_payment_id, v_currency
  from public.payments
  where provider = 'square' and provider_payment_id = p_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;
  if v_currency is distinct from p_currency then
    return jsonb_build_object('ok', false, 'reason', 'currency_mismatch');
  end if;

  insert into public.payment_refunds (payment_id, provider_refund_id, amount_cents)
  values (v_payment_id, p_provider_refund_id, p_amount_cents)
  on conflict (provider_refund_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.payments set refund_status = 'refunded' where id = v_payment_id;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

revoke execute on function public.svc_mark_refunded(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.svc_mark_refunded(text, text, integer, text) to service_role;

-- The order's refunded total. The new column goes last, so the view keeps its place, its
-- grants, and its rule of running with the caller's rights.
create or replace view public.order_details
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
  ), 'none'::public.refund_status) as refund_status,
  -- How much has gone back to the attendee, across all the order's payments.
  coalesce((
    select sum(r.amount_cents)::integer
    from public.payments p
    join public.payment_refunds r on r.payment_id = p.id
    where p.order_id = o.id
  ), 0) as refunded_cents
from public.orders o
join public.booths b on b.id = o.booth_id
join public.vendors v on v.id = b.vendor_id;

-- The attendee's view of an order, now with the refunded total. get_order_by_token and
-- private.order_payload both build on it.
create or replace function private.attendee_order_payload(p_order_id uuid) returns jsonb
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
    'createdAt', d.created_at,
    'collectedAt', d.collected_at,
    'cancelReason', d.cancel_reason,
    'refundStatus', d.refund_status,
    'refundedCents', d.refunded_cents,
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
