-- The attendee's view of an order now carries when it was placed, which the app's Order
-- type needs. Same function as before with one more field.
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
