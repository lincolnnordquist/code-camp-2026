-- Releases the stock of an unpaid checkout straight away, instead of at its hold end.
-- Used when Square refuses to create the checkout, or when the checkout is closed after
-- a failed payment. svc_expire_checkout keeps its rule that the hold must have ended; both
-- now share one body. A missing hold end counts as "not ended" (the earlier version let it
-- through).

create function private.expire_pending_order(
  p_order_id uuid,
  p_provider_order_id text,
  p_require_hold_ended boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
begin
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
  if p_require_hold_ended and (v_order.hold_ends_at is null or v_order.hold_ends_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'hold_not_ended');
  end if;
  -- Proves the Square link was closed: Square named the order it cancelled.
  if v_order.provider_order_id is distinct from p_provider_order_id then
    return jsonb_build_object('ok', false, 'reason', 'provider_order_mismatch');
  end if;

  perform private.release_stock(p_order_id);
  update public.orders set status = 'expired' where id = p_order_id;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- Same behavior as before, plus the missing-hold rule. Existing grants stay.
create or replace function public.svc_expire_checkout(
  p_order_id uuid,
  p_provider_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  return private.expire_pending_order(p_order_id, p_provider_order_id, true);
end;
$$;

-- Releases an unpaid checkout now, with no wait for the hold to end. Pass the provider
-- order id that Square reported as cancelled after the link was deleted, or null when no
-- checkout was ever attached (Square refused to create it).
create function public.svc_release_checkout(
  p_order_id uuid,
  p_provider_order_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  return private.expire_pending_order(p_order_id, p_provider_order_id, false);
end;
$$;

revoke execute on function public.svc_release_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_release_checkout(uuid, text) to service_role;
