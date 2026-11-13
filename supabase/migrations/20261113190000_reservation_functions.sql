-- The order functions that attendees and vendor staff call, and reservation expiry.
-- Each user function authorizes with auth.uid() inside the function and is granted by
-- name to authenticated users only (attendees are anonymous sessions, staff are signed in).
-- Refusals are returned as data: { "ok": false, "reason": "..." }.

-- Helpers -------------------------------------------------------------------

create function private.is_booth_staff(p_booth_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.booths b
    join public.vendor_staff s on s.vendor_id = b.vendor_id
    where b.id = p_booth_id and s.user_id = auth.uid()
  );
$$;

-- Puts the stock held by an order back on its products. The caller has already locked
-- the order. Products are locked in id order, the same order place_order uses.
create function private.release_stock(p_order_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.products
  where id in (select product_id from public.order_items where order_id = p_order_id)
  order by id
  for update;

  update public.products p
  set available_qty = p.available_qty + i.quantity
  from public.order_items i
  where i.order_id = p_order_id and p.id = i.product_id;
end;
$$;

-- Attendee ------------------------------------------------------------------

-- Reserves stock for an unpaid order. The attendee pays the vendor at pickup.
-- p_items is [{ "productId": "...", "quantity": 1 }]. A repeated p_request_id returns the
-- first order and deducts nothing more.
create function public.create_reservation(
  p_booth_id uuid,
  p_items jsonb,
  p_email text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  return private.place_order(auth.uid(), p_booth_id, p_items, p_email, p_request_id, 'reservation');
end;
$$;

-- An attendee cancels their own reservation while it is confirmed or ready.
-- The stock returns to the products.
create function public.cancel_reservation(p_order_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and user_id = auth.uid() and type = 'reservation'
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
  return private.order_payload(p_order_id);
end;
$$;

-- Vendor staff -----------------------------------------------------------------

-- Staff set the items aside: confirmed to ready.
create function public.mark_order_ready(p_order_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not private.is_booth_staff(v_order.booth_id) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_order.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed_in_status', 'status', v_order.status);
  end if;

  update public.orders set status = 'ready' where id = p_order_id;
  return private.order_payload(p_order_id);
end;
$$;

-- Staff hand over an order against its pickup code. The code is only ever checked with
-- the booth, so a code from another booth is "not_found". When a code matches several
-- orders, an active one wins over an earlier finished one.
create function public.collect_order(p_booth_id uuid, p_pickup_code text) returns jsonb
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
    return jsonb_build_object('ok', false, 'reason', 'already_collected', 'at', v_order.collected_at);
  end if;
  if v_order.status in ('cancelled', 'expired') then
    return jsonb_build_object('ok', false, 'reason', v_order.status);
  end if;

  update public.orders set status = 'collected', collected_at = now() where id = v_order.id;
  return private.order_payload(v_order.id);
end;
$$;

-- Staff cancel an order with a reason the attendee sees. Stock is not returned
-- automatically. A cancelled prepaid order is marked refund due.
create function public.cancel_order(p_order_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not private.is_booth_staff(v_order.booth_id) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if v_order.status not in ('confirmed', 'ready') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed_in_status', 'status', v_order.status);
  end if;

  update public.orders set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_order_id;
  if v_order.type = 'prepaid' then
    update public.payments set refund_status = 'due' where order_id = p_order_id and refund_status = 'none';
  end if;
  return private.order_payload(p_order_id);
end;
$$;

-- Staff set the quantity open to new orders. Stock already held by orders is unaffected.
create function public.set_product_stock(p_product_id uuid, p_available_qty integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found or not private.is_booth_staff(v_product.booth_id) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;
  if p_available_qty is null or p_available_qty < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_quantity');
  end if;

  update public.products set available_qty = p_available_qty where id = p_product_id;
  return jsonb_build_object('ok', true, 'availableQty', p_available_qty);
end;
$$;

-- Staff pause or resume ordering. Existing orders continue while paused.
create function public.set_ordering_paused(p_booth_id uuid, p_paused boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_paused is null or not private.is_booth_staff(p_booth_id) then
    return jsonb_build_object('ok', false, 'reason', 'booth_not_found');
  end if;

  update public.booths set ordering_paused = p_paused where id = p_booth_id;
  return jsonb_build_object('ok', true, 'paused', p_paused);
end;
$$;

-- Reservation expiry ----------------------------------------------------------------

-- Expires reservations whose hold has ended and returns their stock, in one transaction.
-- Orders are locked before products, the order every function in this file uses.
-- A paid (prepaid) order is never touched here.
create function private.expire_reservations() returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(o.id) into v_ids
  from (
    select id
    from public.orders
    where type = 'reservation'
      and status in ('confirmed', 'ready')
      and hold_ends_at <= now()
    order by id
    for update skip locked
  ) o;
  if v_ids is null then
    return 0;
  end if;

  perform 1
  from public.products
  where id in (select product_id from public.order_items where order_id = any (v_ids))
  order by id
  for update;

  update public.products p
  set available_qty = p.available_qty + s.qty
  from (
    select product_id, sum(quantity)::integer as qty
    from public.order_items
    where order_id = any (v_ids)
    group by product_id
  ) s
  where p.id = s.product_id;

  update public.orders set status = 'expired' where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('expire-reservations', '* * * * *', 'select private.expire_reservations()');

-- Access --------------------------------------------------------------------------
-- Supabase grants new functions to every API role. Take that back and grant by name.

revoke execute on function public.create_reservation(uuid, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.mark_order_ready(uuid) from public, anon, authenticated;
revoke execute on function public.collect_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_product_stock(uuid, integer) from public, anon, authenticated;
revoke execute on function public.set_ordering_paused(uuid, boolean) from public, anon, authenticated;

grant execute on function public.create_reservation(uuid, jsonb, text, text) to authenticated;
grant execute on function public.cancel_reservation(uuid) to authenticated;
grant execute on function public.mark_order_ready(uuid) to authenticated;
grant execute on function public.collect_order(uuid, text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.set_product_stock(uuid, integer) to authenticated;
grant execute on function public.set_ordering_paused(uuid, boolean) to authenticated;
