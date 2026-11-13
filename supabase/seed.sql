-- Demo event, booths and products. It mirrors the sample data in src/shared/api so the
-- stubs and the real database describe the same event. Vendor staff accounts are added
-- in a later change.

insert into public.events (id, slug, name, currency, reservation_hold_minutes, checkout_hold_minutes, floor_plan_url)
values ('e0000000-0000-0000-0000-000000000001', 'demo', 'Demo Convention 2026', 'USD', 120, 15, '/floor-plan.png');

insert into public.vendors (id, name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Pixel Prints'),
  ('f0000000-0000-0000-0000-00000000000b', 'Moon Ceramics'),
  ('f0000000-0000-0000-0000-00000000000c', 'Old Maps Co');

insert into public.booths (id, event_id, vendor_id, code, mode, map_x, map_y, pickup_instructions) values
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'A1', 'reservation', 0.2, 0.3, 'Show your code at the front table.'),
  ('b0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000b', 'B4', 'prepay', 0.6, 0.4, 'Pickup is at the side counter.'),
  ('b0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000c', 'C2', 'discovery', 0.8, 0.7, '');

insert into public.products (id, booth_id, name, category, price_cents, available_qty, max_per_order) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Dragon Print', 'Art', 2500, 1, 2),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Sticker Pack', 'Stickers', 800, 20, 5),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Mug', 'Ceramics', 3200, 6, 2),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000c', 'City Map Poster', 'Art', 1800, 0, 1);

-- The prepay booth takes payment through a Square sandbox seller. The token lives in the
-- Edge Function secret with this name.
insert into public.provider_connections (vendor_id, provider, location_id, token_secret_name)
values ('f0000000-0000-0000-0000-00000000000b', 'square', 'LT26AY1A3MCK2', 'SQUARE_ACCESS_TOKEN_VENDOR_A');
