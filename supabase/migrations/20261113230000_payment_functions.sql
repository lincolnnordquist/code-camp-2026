-- The database side of confirming a prepaid order, reading it back, refunds, and the
-- confirmation email. Called by the Edge Functions; each is granted to service_role only
-- and checks that role inside the function. Refusals are returned as data.
--
-- The caller has already fetched the payment from Square and verified it. These functions
-- trust that, and add a second check of amount, currency and seller against our own order.

-- One row per Square refund, so a repeated refund message changes nothing.
create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  provider_refund_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.payment_refunds enable row level security;
-- No policy: only service functions touch it.

-- What an Edge Function needs to look an order's payment up in Square.
create function private.checkout_payload(p_order_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'orderId', o.id,
    'status', o.status,
    'checkoutLinkId', o.checkout_link_id,
    'providerOrderId', o.provider_order_id,
    'totalCents', o.total_cents,
    'currency', o.currency,
    'connection', jsonb_build_object(
      'tokenSecretName', pc.token_secret_name,
      'locationId', pc.location_id
    )
  )
  from public.orders o
  join public.booths b on b.id = o.booth_id
  join public.provider_connections pc on pc.vendor_id = b.vendor_id and pc.provider = 'square'
  where o.id = p_order_id and o.type = 'prepaid';
$$;

-- For the return page: the order, only for the user who owns it.
create function public.svc_get_checkout(p_order_id uuid, p_user_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  if not exists (select 1 from public.orders where id = p_order_id and user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  return coalesce(
    private.checkout_payload(p_order_id),
    jsonb_build_object('ok', false, 'reason', 'order_not_found')
  );
end;
$$;

-- For the webhook, which only has Square's order id.
create function public.svc_get_checkout_by_provider_order(p_provider_order_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  perform private.require_service_role();
  select id into v_order_id from public.orders where provider_order_id = p_provider_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  return coalesce(
    private.checkout_payload(v_order_id),
    jsonb_build_object('ok', false, 'reason', 'order_not_found')
  );
end;
$$;

-- Records a verified Square payment against its order. The order row is locked, so the
-- return page and the webhook arriving together confirm it once. Outcomes:
--   confirmed          the order was pending_payment and is now confirmed
--   already_confirmed  the same payment id again: nothing new is recorded
--   refund_due         the money is owed back: the order was expired or cancelled, or it
--                      was already paid by another payment. The payment is recorded as
--                      refund due and the order is left as it is.
-- A payment that does not match the order's amount, currency, or the booth's Square
-- seller is refused and nothing changes.
create function public.svc_confirm_paid_order(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_cents integer,
  p_currency text,
  p_location_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_location text;
  v_payment public.payments;
begin
  perform private.require_service_role();

  select * into v_order from public.orders where provider_order_id = p_provider_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select pc.location_id into v_location
  from public.booths b
  join public.provider_connections pc on pc.vendor_id = b.vendor_id and pc.provider = 'square'
  where b.id = v_order.booth_id;
  if v_location is distinct from p_location_id then
    return jsonb_build_object('ok', false, 'reason', 'location_mismatch');
  end if;
  if v_order.currency is distinct from p_currency then
    return jsonb_build_object('ok', false, 'reason', 'currency_mismatch');
  end if;
  if v_order.total_cents is distinct from p_amount_cents then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  select * into v_payment
  from public.payments
  where provider = 'square' and provider_payment_id = p_provider_payment_id;
  if found then
    if v_payment.order_id <> v_order.id then
      return jsonb_build_object('ok', false, 'reason', 'payment_belongs_to_other_order');
    end if;
    return private.order_payload(v_order.id) || jsonb_build_object(
      'outcome', case when v_payment.refund_status = 'none' then 'already_confirmed' else 'refund_due' end,
      'changed', false
    );
  end if;

  begin
    if v_order.status = 'pending_payment' then
      update public.orders set status = 'confirmed' where id = v_order.id;
      insert into public.payments (order_id, provider_payment_id, amount_cents, currency)
      values (v_order.id, p_provider_payment_id, p_amount_cents, p_currency);
      return private.order_payload(v_order.id) || jsonb_build_object('outcome', 'confirmed', 'changed', true);
    end if;

    insert into public.payments (order_id, provider_payment_id, amount_cents, currency, refund_status)
    values (v_order.id, p_provider_payment_id, p_amount_cents, p_currency, 'due');
    return private.order_payload(v_order.id) || jsonb_build_object('outcome', 'refund_due', 'changed', true);
  exception when unique_violation then
    -- The same Square payment was recorded for another order in the meantime.
    return jsonb_build_object('ok', false, 'reason', 'payment_belongs_to_other_order');
  end;
end;
$$;

-- A completed Square refund marks its payment refunded, whether the refund was partial and
-- whether the payment was refund due or not. The refund id makes a repeated message a no-op.
create function public.svc_mark_refunded(
  p_provider_payment_id text,
  p_provider_refund_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_inserted integer;
begin
  perform private.require_service_role();
  if p_provider_refund_id is null or btrim(p_provider_refund_id) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_refund_id');
  end if;

  select id into v_payment_id
  from public.payments
  where provider = 'square' and provider_payment_id = p_provider_payment_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  insert into public.payment_refunds (payment_id, provider_refund_id)
  values (v_payment_id, p_provider_refund_id)
  on conflict (provider_refund_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.payments set refund_status = 'refunded' where id = v_payment_id;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- Claims the confirmation email before it is sent. The first call sets email_sent_at and
-- returns what the email needs; every later call says "repeat", so the return page and the
-- webhook cannot both send. p_user_id is passed when the caller is an attendee session and
-- must own the order; the webhook has no user and passes null.
create function public.svc_mark_email_sent(
  p_order_id uuid,
  p_user_id uuid default null
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
  if not found or (p_user_id is not null and v_order.user_id <> p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_order.status not in ('confirmed', 'ready', 'collected') then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed', 'status', v_order.status);
  end if;
  if v_order.email_sent_at is not null then
    return jsonb_build_object('ok', true, 'outcome', 'repeat');
  end if;

  update public.orders set email_sent_at = now() where id = p_order_id;
  return private.order_payload(p_order_id) || jsonb_build_object(
    'outcome', 'first_time',
    'privateToken', v_order.private_token
  );
end;
$$;

-- Undoes the claim after a failed send, so the next trigger can try again. A failed email
-- never changes the order itself.
create function public.svc_clear_email_sent(
  p_order_id uuid,
  p_user_id uuid default null
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
  if not found or (p_user_id is not null and v_order.user_id <> p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  update public.orders set email_sent_at = null where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Supabase grants new functions to every API role. Take that back and grant by name.
revoke execute on function public.svc_get_checkout(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_get_checkout_by_provider_order(text) from public, anon, authenticated;
revoke execute on function public.svc_confirm_paid_order(text, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.svc_mark_refunded(text, text) from public, anon, authenticated;
revoke execute on function public.svc_mark_email_sent(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_clear_email_sent(uuid, uuid) from public, anon, authenticated;

grant execute on function public.svc_get_checkout(uuid, uuid) to service_role;
grant execute on function public.svc_get_checkout_by_provider_order(text) to service_role;
grant execute on function public.svc_confirm_paid_order(text, text, integer, text, text) to service_role;
grant execute on function public.svc_mark_refunded(text, text) to service_role;
grant execute on function public.svc_mark_email_sent(uuid, uuid) to service_role;
grant execute on function public.svc_clear_email_sent(uuid, uuid) to service_role;
