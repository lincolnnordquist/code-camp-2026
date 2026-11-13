-- Service functions called by the Edge Functions for prepaid checkout.
-- Each is granted to service_role only and checks that role inside the function.
-- Refusals are returned as data: { "ok": false, "reason": "..." }.

-- Creates a pending_payment order that holds stock while the attendee is in checkout.
-- The Edge Function authenticates the attendee first and passes their user id.
-- p_items is [{ "productId": "...", "quantity": 1 }]. A repeated p_request_id for the
-- same user returns the first order.
create function public.svc_create_pending_order(
  p_user_id uuid,
  p_booth_id uuid,
  p_items jsonb,
  p_email text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection jsonb;
  v_result jsonb;
begin
  perform private.require_service_role();

  select jsonb_build_object('tokenSecretName', pc.token_secret_name, 'locationId', pc.location_id)
  into v_connection
  from public.booths b
  join public.provider_connections pc on pc.vendor_id = b.vendor_id and pc.provider = 'square'
  where b.id = p_booth_id;

  -- Checked before any stock moves.
  if v_connection is null then
    return jsonb_build_object('ok', false, 'reason', 'checkout_unavailable');
  end if;

  v_result := private.place_order(p_user_id, p_booth_id, p_items, p_email, p_request_id, 'prepaid');
  if (v_result ->> 'ok')::boolean then
    v_result := v_result || jsonb_build_object('connection', v_connection);
  end if;
  return v_result;
end;
$$;

-- Stores the Square checkout link and Square order on a pending_payment order.
-- Repeating the call with the same ids is accepted.
create function public.svc_attach_checkout(
  p_order_id uuid,
  p_checkout_link_id text,
  p_provider_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.require_service_role();

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_order.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_order.status);
  end if;

  if v_order.checkout_link_id is not null then
    if v_order.checkout_link_id = p_checkout_link_id and v_order.provider_order_id = p_provider_order_id then
      return jsonb_build_object('ok', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_attached');
  end if;

  update public.orders
  set checkout_link_id = p_checkout_link_id, provider_order_id = p_provider_order_id
  where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Marks an unpaid checkout expired and returns its stock. Call it only after the Square
-- link was deleted and Square named the cancelled order: pass that provider order id.
-- It must equal the one stored on the order. An order whose checkout was never created
-- has none stored, so pass null. A confirmed order is never expired.
create function public.svc_expire_checkout(
  p_order_id uuid,
  p_provider_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.require_service_role();

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_order.status = 'expired' then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  if v_order.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_order.status);
  end if;
  if v_order.hold_ends_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'hold_not_ended');
  end if;
  if v_order.provider_order_id is distinct from p_provider_order_id then
    return jsonb_build_object('ok', false, 'reason', 'provider_order_mismatch');
  end if;

  -- Same lock order as place_order: products by id.
  perform 1
  from public.products
  where id in (select product_id from public.order_items where order_id = p_order_id)
  order by id
  for update;

  update public.products p
  set available_qty = p.available_qty + i.quantity
  from public.order_items i
  where i.order_id = p_order_id and p.id = i.product_id;

  update public.orders set status = 'expired' where id = p_order_id;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- The pending_payment orders past their hold end, oldest first, with what the
-- expire-checkouts function needs to look each one up in Square.
create function public.svc_list_overdue_checkouts(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();

  return jsonb_build_object(
    'ok', true,
    'orders', coalesce((
      select jsonb_agg(row_to_json_order.o order by row_to_json_order.hold_ends_at)
      from (
        select
          o.hold_ends_at,
          jsonb_build_object(
            'orderId', o.id,
            'checkoutLinkId', o.checkout_link_id,
            'providerOrderId', o.provider_order_id,
            'totalCents', o.total_cents,
            'currency', o.currency,
            'connection', jsonb_build_object(
              'tokenSecretName', pc.token_secret_name,
              'locationId', pc.location_id
            )
          ) as o
        from public.orders o
        join public.booths b on b.id = o.booth_id
        join public.provider_connections pc on pc.vendor_id = b.vendor_id and pc.provider = 'square'
        where o.status = 'pending_payment' and o.hold_ends_at <= now()
        order by o.hold_ends_at
        limit greatest(p_limit, 1)
      ) row_to_json_order
    ), '[]'::jsonb)
  );
end;
$$;

-- Supabase grants new functions to every API role. Take that back and grant by name.
revoke execute on function public.svc_create_pending_order(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.svc_attach_checkout(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.svc_expire_checkout(uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_list_overdue_checkouts(integer) from public, anon, authenticated;

grant execute on function public.svc_create_pending_order(uuid, uuid, jsonb, text, text) to service_role;
grant execute on function public.svc_attach_checkout(uuid, text, text) to service_role;
grant execute on function public.svc_expire_checkout(uuid, text) to service_role;
grant execute on function public.svc_list_overdue_checkouts(integer) to service_role;
