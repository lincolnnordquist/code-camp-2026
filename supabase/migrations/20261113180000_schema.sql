-- Tables, access rules and the shared rule for placing an order.
-- Writes to orders, order items and stock happen only inside database functions.

create schema if not exists private;
revoke all on schema private from public;

-- Types ---------------------------------------------------------------------

create type public.booth_mode as enum ('prepay', 'reservation', 'discovery');
create type public.order_type as enum ('reservation', 'prepaid');
create type public.order_status as enum (
  'pending_payment', 'confirmed', 'ready', 'collected', 'cancelled', 'expired'
);
create type public.refund_status as enum ('none', 'due', 'refunded');

-- Tables --------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  currency text not null default 'USD' check (char_length(currency) = 3),
  reservation_hold_minutes integer not null default 120 check (reservation_hold_minutes > 0),
  checkout_hold_minutes integer not null default 15 check (checkout_hold_minutes > 0),
  floor_plan_url text not null,
  created_at timestamptz not null default now()
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- A vendor's place at one event. A vendor has one booth per event in this build.
create table public.booths (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  code text not null,
  mode public.booth_mode not null,
  ordering_paused boolean not null default false,
  -- Position on the floor plan image as a fraction of its width and height.
  map_x numeric(5, 4) not null check (map_x between 0 and 1),
  map_y numeric(5, 4) not null check (map_y between 0 and 1),
  pickup_instructions text not null default '',
  created_at timestamptz not null default now(),
  unique (event_id, code),
  unique (event_id, vendor_id)
);

create table public.vendor_staff (
  user_id uuid not null references auth.users (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  primary key (user_id, vendor_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  booth_id uuid not null references public.booths (id) on delete cascade,
  name text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  -- Stock still open to new orders. Stock held by an active order is already deducted.
  available_qty integer not null check (available_qty >= 0),
  max_per_order integer not null default 1 check (max_per_order > 0),
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  booth_id uuid not null references public.booths (id),
  user_id uuid not null references auth.users (id),
  type public.order_type not null,
  status public.order_status not null,
  email text not null,
  total_cents integer not null check (total_cents >= 0),
  currency text not null check (char_length(currency) = 3),
  pickup_code text not null,
  -- Opens one order on any device from the emailed link.
  private_token uuid not null unique default gen_random_uuid(),
  hold_ends_at timestamptz,
  -- Generated in the browser so a retried request returns the first order.
  request_id text not null,
  collected_at timestamptz,
  cancel_reason text,
  checkout_link_id text,
  provider_order_id text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

-- A pickup code is unique among a booth's active orders.
create unique index orders_active_pickup_code
  on public.orders (booth_id, pickup_code)
  where status in ('pending_payment', 'confirmed', 'ready');
create unique index orders_checkout_link_id on public.orders (checkout_link_id)
  where checkout_link_id is not null;
create unique index orders_provider_order_id on public.orders (provider_order_id)
  where provider_order_id is not null;
create index orders_booth_status on public.orders (booth_id, status);
create index orders_user on public.orders (user_id);
create index orders_overdue_checkouts on public.orders (hold_ends_at)
  where status = 'pending_payment';
create index products_booth on public.products (booth_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  -- Name and price at the time of ordering.
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);
create index order_items_order on public.order_items (order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  provider text not null default 'square',
  provider_payment_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (char_length(currency) = 3),
  verified_at timestamptz not null default now(),
  refund_status public.refund_status not null default 'none',
  unique (provider, provider_payment_id)
);
create index payments_order on public.payments (order_id);

-- Which payment provider and seller a vendor uses. The token itself is an Edge Function
-- secret; only its name is stored here.
create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  provider text not null default 'square',
  location_id text not null,
  token_secret_name text not null,
  unique (vendor_id, provider)
);

-- Access rules --------------------------------------------------------------

alter table public.events enable row level security;
alter table public.vendors enable row level security;
alter table public.booths enable row level security;
alter table public.vendor_staff enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.provider_connections enable row level security;

-- The catalog is readable by anyone.
create policy events_read on public.events for select to anon, authenticated using (true);
create policy vendors_read on public.vendors for select to anon, authenticated using (true);
create policy booths_read on public.booths for select to anon, authenticated using (true);
create policy products_read on public.products for select to anon, authenticated using (true);

create policy vendor_staff_read_own on public.vendor_staff
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Orders are readable by their attendee and by staff of their booth.
create policy orders_read on public.orders
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.booths b
      join public.vendor_staff s on s.vendor_id = b.vendor_id
      where b.id = orders.booth_id and s.user_id = (select auth.uid())
    )
  );

-- These read through orders, so they follow the access rule above.
create policy order_items_read on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

create policy payments_read on public.payments
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payments.order_id));

-- provider_connections has no policy: only service functions read it.

-- The browser has no write permission anywhere. Writes go through database functions.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on public.provider_connections from anon, authenticated;

alter publication supabase_realtime add table public.orders;

-- Rules that must always hold -------------------------------------------------

-- collected, cancelled and expired orders never change status again.
create function private.guard_final_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('collected', 'cancelled', 'expired') and new.status <> old.status then
    raise exception 'order % is % and cannot change status', old.id, old.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger orders_guard_final_status
  before update of status on public.orders
  for each row execute function private.guard_final_status();

-- Shared helpers ------------------------------------------------------------

create function private.require_service_role() returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'this function is for the service role only' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- The order as the functions return it. Money is integer cents.
create function private.order_payload(p_order_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'orderId', o.id,
    'boothId', o.booth_id,
    'type', o.type,
    'status', o.status,
    'pickupCode', o.pickup_code,
    'holdEndsAt', o.hold_ends_at,
    'totalCents', o.total_cents,
    'currency', o.currency,
    'buyerEmail', o.email,
    'checkoutLinkId', o.checkout_link_id,
    'providerOrderId', o.provider_order_id,
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
      where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;

create function private.new_pickup_code(p_booth_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := lpad(floor(random() * 10000)::integer::text, 4, '0');
    exit when not exists (
      select 1 from public.orders
      where booth_id = p_booth_id
        and pickup_code = v_code
        and status in ('pending_payment', 'confirmed', 'ready')
    );
  end loop;
  return v_code;
end;
$$;

-- Checks the request, deducts stock and creates the order, all in the caller's
-- transaction. Reservations and prepaid checkouts both use it, so the stock rule
-- exists once. Refusals are returned as data and change nothing.
create function private.place_order(
  p_user_id uuid,
  p_booth_id uuid,
  p_items jsonb,
  p_email text,
  p_request_id text,
  p_type public.order_type
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  v_booth public.booths;
  v_event public.events;
  v_lines jsonb;
  v_missing uuid[];
  v_over uuid[];
  v_short uuid[];
  v_total integer;
  v_order_id uuid;
begin
  -- One order at a time per booth: two requests for the last item queue here, and a
  -- repeated request cannot slip past the idempotency check below.
  perform pg_advisory_xact_lock(hashtextextended(p_booth_id::text, 0));

  -- A repeated request returns the first order and creates nothing.
  select id into v_existing
  from public.orders
  where user_id = p_user_id and request_id = p_request_id;
  if found then
    return private.order_payload(v_existing);
  end if;

  if p_email is null or btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  select * into v_booth from public.booths where id = p_booth_id;
  if not found
     or v_booth.mode <> (case p_type when 'prepaid' then 'prepay' else 'reservation' end)::public.booth_mode then
    return jsonb_build_object('ok', false, 'reason', 'booth_not_accepting_orders');
  end if;
  if v_booth.ordering_paused then
    return jsonb_build_object('ok', false, 'reason', 'ordering_paused');
  end if;

  -- Merge repeated products into one line each.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('productId', s.pid, 'quantity', s.qty)), '[]'::jsonb)
    into v_lines
    from (
      select (e ->> 'productId')::uuid as pid, sum((e ->> 'quantity')::integer) as qty
      from jsonb_array_elements(p_items) e
      group by 1
    ) s;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end;
  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;
  if exists (select 1 from jsonb_array_elements(v_lines) l where (l ->> 'quantity')::integer <= 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;

  -- Lock the products in a fixed order so concurrent orders cannot deadlock.
  perform 1
  from public.products
  where booth_id = p_booth_id
    and id in (select (l ->> 'productId')::uuid from jsonb_array_elements(v_lines) l)
  order by id
  for update;

  select
    array_agg(l.pid) filter (where p.id is null),
    array_agg(l.pid) filter (where p.id is not null and l.qty > p.max_per_order),
    array_agg(l.pid) filter (where p.id is not null and l.qty > p.available_qty)
  into v_missing, v_over, v_short
  from (
    select (x ->> 'productId')::uuid as pid, (x ->> 'quantity')::integer as qty
    from jsonb_array_elements(v_lines) x
  ) l
  left join public.products p on p.id = l.pid and p.booth_id = p_booth_id;

  if v_missing is not null then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'productIds', to_jsonb(v_missing));
  end if;
  if v_over is not null then
    return jsonb_build_object('ok', false, 'reason', 'over_max_per_order', 'productIds', to_jsonb(v_over));
  end if;
  if v_short is not null then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_stock', 'productIds', to_jsonb(v_short));
  end if;

  select * into v_event from public.events where id = v_booth.event_id;

  select sum(p.price_cents::bigint * l.qty)::integer
  into v_total
  from (
    select (x ->> 'productId')::uuid as pid, (x ->> 'quantity')::integer as qty
    from jsonb_array_elements(v_lines) x
  ) l
  join public.products p on p.id = l.pid;

  update public.products p
  set available_qty = p.available_qty - l.qty
  from (
    select (x ->> 'productId')::uuid as pid, (x ->> 'quantity')::integer as qty
    from jsonb_array_elements(v_lines) x
  ) l
  where p.id = l.pid;

  insert into public.orders (
    booth_id, user_id, type, status, email, total_cents, currency,
    pickup_code, hold_ends_at, request_id
  )
  values (
    p_booth_id,
    p_user_id,
    p_type,
    (case p_type when 'prepaid' then 'pending_payment' else 'confirmed' end)::public.order_status,
    btrim(p_email),
    v_total,
    v_event.currency,
    private.new_pickup_code(p_booth_id),
    now() + make_interval(
      mins => case p_type when 'prepaid' then v_event.checkout_hold_minutes else v_event.reservation_hold_minutes end
    ),
    p_request_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, name, quantity, unit_price_cents)
  select v_order_id, p.id, p.name, l.qty, p.price_cents
  from (
    select (x ->> 'productId')::uuid as pid, (x ->> 'quantity')::integer as qty
    from jsonb_array_elements(v_lines) x
  ) l
  join public.products p on p.id = l.pid;

  return private.order_payload(v_order_id);
end;
$$;
