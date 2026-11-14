-- When staff enter the code of an order that cannot be handed over (already collected,
-- cancelled, or expired), the refusal now also carries that order, so the vendor screen can
-- show its items, total and reason. Nothing else changes: the checks, their order, and the
-- reasons are the same, and a code that finds nothing still returns no order. The booth's
-- staff check still comes first, so another booth's staff never see the order.
-- Existing grants stay with create or replace.

create or replace function public.collect_order(p_booth_id uuid, p_pickup_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not private.is_booth_staff(p_booth_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_order
  from public.orders
  where booth_id = p_booth_id and pickup_code = btrim(p_pickup_code)
  order by (status in ('confirmed', 'ready')) desc, created_at desc
  limit 1
  for update;

  -- An unpaid checkout is not yet an order the attendee can collect.
  if not found or v_order.status = 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_order.status = 'collected' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_collected',
      'at', v_order.collected_at,
      'order', private.attendee_order_payload(v_order.id)
    );
  end if;
  if v_order.status in ('cancelled', 'expired') then
    return jsonb_build_object(
      'ok', false,
      'reason', v_order.status,
      'order', private.attendee_order_payload(v_order.id)
    );
  end if;

  update public.orders set status = 'collected', collected_at = now() where id = v_order.id;
  return private.order_payload(v_order.id);
end;
$$;
