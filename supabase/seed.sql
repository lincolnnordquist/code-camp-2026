-- Demo event, booths and products. It mirrors the sample data in src/shared/api so the
-- stubs and the real database describe the same event. Images are placeholders in
-- supabase/seed-assets, uploaded with `supabase seed buckets`. Vendor staff accounts are
-- added in a later change.

insert into public.events (id, slug, name, venue_name, currency, reservation_hold_minutes, checkout_hold_minutes, floor_plan_url)
values ('e0000000-0000-0000-0000-000000000001', 'demo', 'Demo Convention 2026', 'Demo Convention Center', 'USD', 120, 15, null);

-- Logo and banner paths point into the 'assets' storage bucket. These are placeholders.
insert into public.vendors (id, name, slogan, logo_path, banner_path) values
  ('f0000000-0000-0000-0000-00000000000a', 'Pixel Prints', 'Art you can hold', 'placeholders/logo.svg', 'placeholders/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000b', 'Moon Ceramics', 'Handmade, one at a time', 'placeholders/logo.svg', 'placeholders/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000c', 'Old Maps Co', 'Every place has a story', 'placeholders/logo.svg', 'placeholders/banner.svg');

insert into public.booths (id, event_id, vendor_id, code, mode, map_x, map_y, pickup_instructions) values
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'A1', 'reservation', 0.2, 0.3, 'Show your code at the front table.'),
  ('b0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000b', 'B4', 'prepay', 0.6, 0.4, 'Pickup is at the side counter.'),
  ('b0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000c', 'C2', 'discovery', 0.8, 0.7, '');

insert into public.products (id, booth_id, name, category, description, image_path, price_cents, available_qty, max_per_order) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Dragon Print', 'Art', 'A signed print of a dragon over the mountains. One of a kind.', 'placeholders/product.svg', 2500, 1, 2),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Sticker Pack', 'Stickers', 'Five weatherproof vinyl stickers.', 'placeholders/product.svg', 800, 20, 5),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Mug', 'Ceramics', 'A hand-thrown stoneware mug with a glazed handle.', 'placeholders/product.svg', 3200, 6, 2),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000c', 'City Map Poster', 'Art', 'A reproduction of an old city map, printed on heavy paper.', 'placeholders/product.svg', 1800, 0, 1);

-- The prepay booth takes payment through a Square sandbox seller. The token lives in the
-- Edge Function secret with this name.
insert into public.provider_connections (vendor_id, provider, location_id, token_secret_name)
values ('f0000000-0000-0000-0000-00000000000b', 'square', 'LT26AY1A3MCK2', 'SQUARE_ACCESS_TOKEN_VENDOR_A');
