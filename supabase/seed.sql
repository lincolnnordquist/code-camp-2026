-- Demo event, booths and products. It mirrors the sample data in src/shared/api so the
-- stubs and the real database describe the same event. Images are placeholders in
-- supabase/seed-assets, uploaded with `supabase seed buckets`. Vendor staff accounts are
-- added below.

insert into public.events (id, slug, name, venue_name, currency, reservation_hold_minutes, checkout_hold_minutes, floor_plan_url)
values ('e0000000-0000-0000-0000-000000000001', 'code-camp-2026', 'Code Camp 2026', 'Demo Convention Center', 'USD', 120, 15, null);

-- Image paths point into the 'assets' storage bucket: vendors/<vendor-slug>/logo and banner,
-- products/<vendor-slug>/<product-slug>. The files are placeholders for now.
insert into public.vendors (id, name, slogan, logo_path, banner_path) values
  ('f0000000-0000-0000-0000-00000000000a', 'Pixel Prints', 'Art you can hold', 'vendors/pixel-prints/logo.svg', 'vendors/pixel-prints/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000b', 'Moon Ceramics', 'Handmade, one at a time', 'vendors/moon-ceramics/logo.svg', 'vendors/moon-ceramics/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000c', 'Old Maps Co', 'Every place has a story', 'vendors/old-maps-co/logo.svg', 'vendors/old-maps-co/banner.svg');

insert into public.booths (id, event_id, vendor_id, code, mode, map_x, map_y, pickup_instructions) values
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'A1', 'reservation', 0.2, 0.3, 'Show your code at the front table.'),
  ('b0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000b', 'B4', 'prepay', 0.6, 0.4, 'Pickup is at the side counter.'),
  ('b0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000c', 'C2', 'discovery', 0.8, 0.7, '');

insert into public.products (id, booth_id, name, category, description, image_path, price_cents, available_qty, max_per_order) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Dragon Print', 'Art', 'A signed print of a dragon over the mountains. One of a kind.', 'products/pixel-prints/dragon-print.svg', 2500, 1, 2),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Sticker Pack', 'Stickers', 'Five weatherproof vinyl stickers.', 'products/pixel-prints/sticker-pack.svg', 800, 20, 5),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Mug', 'Ceramics', 'A hand-thrown stoneware mug with a glazed handle.', 'products/moon-ceramics/mug.svg', 3200, 6, 2),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000c', 'City Map Poster', 'Art', 'A reproduction of an old city map, printed on heavy paper.', 'products/old-maps-co/city-map-poster.svg', 1800, 0, 1);

-- The prepay booth takes payment through a Square sandbox seller. The token lives in the
-- Edge Function secret with this name.
insert into public.provider_connections (vendor_id, provider, location_id, token_secret_name)
values ('f0000000-0000-0000-0000-00000000000b', 'square', 'LT26AY1A3MCK2', 'SQUARE_ACCESS_TOKEN_VENDOR_A');

-- Vendor staff logins, one per vendor. DEMO ONLY: every account has the password
-- 'demo-password', so change these on any project that is public. The token columns are
-- empty strings, not null, or sign-in fails.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated', s.email,
  extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('d0000000-0000-0000-0000-00000000000a'::uuid, 'staff-pixel-prints@example.com'),
  ('d0000000-0000-0000-0000-00000000000b'::uuid, 'staff-moon-ceramics@example.com'),
  ('d0000000-0000-0000-0000-00000000000c'::uuid, 'staff-old-maps-co@example.com')
) as s (id, email);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.id in (
  'd0000000-0000-0000-0000-00000000000a',
  'd0000000-0000-0000-0000-00000000000b',
  'd0000000-0000-0000-0000-00000000000c'
);

insert into public.vendor_staff (user_id, vendor_id) values
  ('d0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a'),
  ('d0000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b'),
  ('d0000000-0000-0000-0000-00000000000c', 'f0000000-0000-0000-0000-00000000000c');
