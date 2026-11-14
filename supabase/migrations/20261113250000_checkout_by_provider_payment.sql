-- Finds an order from a Square payment id, for the refund path of the webhook. A refund
-- message names its own Square order, not the one that was paid, so only the payment id
-- leads back to the right order and seller.
--
-- It finds only payments we have recorded. For any other payment id the answer is
-- order_not_found, and the caller retries later, since a refund message can arrive before
-- its payment message. The order is returned whatever its status: a payment recorded as
-- refund due belongs to an expired or cancelled order, and a normal paid order can be
-- refunded too. Same result fields as svc_get_checkout_by_provider_order.
create function public.svc_get_checkout_by_provider_payment(p_provider_payment_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  perform private.require_service_role();
  select order_id into v_order_id
  from public.payments
  where provider = 'square' and provider_payment_id = p_provider_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  return coalesce(
    private.checkout_payload(v_order_id),
    jsonb_build_object('ok', false, 'reason', 'order_not_found')
  );
end;
$$;

revoke execute on function public.svc_get_checkout_by_provider_payment(text) from public, anon, authenticated;
grant execute on function public.svc_get_checkout_by_provider_payment(text) to service_role;
