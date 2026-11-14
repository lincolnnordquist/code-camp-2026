-- Demo event, booths and products: the Code Camp hall at Vasion Headquarters, with the attendee
-- app's demo catalog. It mirrors src/shared/api/sample-store.ts (same ids and values), so the stubs
-- and the real database describe the same event. Images are in supabase/seed-assets, uploaded with
-- `supabase seed buckets`; the product photos are demo use only (supabase/SEED-IMAGE-CREDITS.md).
-- The drawn hall (walls, stage, table grid) is not seeded: events has no floor_layout column yet,
-- so the map shows the booth plates at map_x and map_y without the floor plan. Vendor staff
-- accounts are added at the end.

insert into public.events (id, slug, name, venue_name, currency, reservation_hold_minutes, checkout_hold_minutes, floor_plan_url)
values ('e0000000-0000-0000-0000-000000000001', 'code-camp-2026', 'Code Camp 2026', 'Vasion Headquarters', 'USD', 120, 15, null);

-- Image paths point into the 'assets' storage bucket: vendors/<vendor-slug>/logo and banner,
-- products/<vendor-slug>/<product-slug>.
insert into public.vendors (id, name, slogan, logo_path, banner_path) values
  ('f0000000-0000-0000-0000-00000000000d', 'Wall Rose Goods', 'Anime apparel and patches', 'vendors/wall-rose-goods/logo.svg', 'vendors/wall-rose-goods/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000a', 'Pixel Forge Prints', 'Art prints and posters', 'vendors/pixel-forge-prints/logo.svg', 'vendors/pixel-forge-prints/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000b', 'Critical Hit Dice', 'Dice sets and tabletop gear', 'vendors/critical-hit-dice/logo.svg', 'vendors/critical-hit-dice/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000e', 'Soft Kaiju Plush', 'Handmade plush monsters', 'vendors/soft-kaiju-plush/logo.svg', 'vendors/soft-kaiju-plush/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000f', 'Scout Regiment Figures', 'Figures and collectibles', 'vendors/scout-regiment-figures/logo.svg', 'vendors/scout-regiment-figures/banner.svg'),
  ('f0000000-0000-0000-0000-00000000000c', 'Inkwell Artist Alley', 'Commissions and sketches', 'vendors/inkwell-artist-alley/logo.svg', 'vendors/inkwell-artist-alley/banner.svg'),
  ('f0000000-0000-0000-0000-000000000010', 'DibSpot', 'The team behind this app', 'vendors/dibspot/logo.svg', 'vendors/dibspot/banner.svg');

-- Codes are the hall's tables: columns A to I from left to right, rows 1 (back, by the kitchen)
-- to 7 (front, by the stage). map_x and map_y are each table's centre on the drawn hall. DibSpot
-- (H6) is the team's own table: browse only, with no products.
insert into public.booths (id, event_id, vendor_id, code, mode, ordering_paused, map_x, map_y, pickup_instructions) values
  ('b0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000d', 'A3', 'reservation', false, 0.1, 0.5776, 'Show your code at the front table. Pay by card or cash.'),
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'B6', 'reservation', false, 0.2, 0.3165, 'Pickup shelf on the left side of the booth.'),
  ('b0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000b', 'C2', 'prepay', false, 0.3, 0.6647, 'Prepaid orders at the blue counter.'),
  ('b0000000-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000e', 'D5', 'reservation', true, 0.4, 0.4035, 'Ask any staff member wearing green.'),
  ('b0000000-0000-0000-0000-00000000000f', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f', 'E4', 'reservation', false, 0.5, 0.4906, 'Pickup window at the back of the booth.'),
  ('b0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000c', 'I7', 'discovery', false, 0.9, 0.2294, 'Walk up only.'),
  ('b0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000010', 'H6', 'discovery', false, 0.8, 0.3165, 'Come say hi.');

insert into public.products (id, booth_id, name, category, description, image_path, price_cents, available_qty, max_per_order) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000d', 'Attack on Titan Survey Corps Hoodie', 'Apparel', 'Embroidered wings of freedom, unisex fit.', 'products/wall-rose-goods/survey-corps-hoodie.webp', 5500, 4, 2),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000d', 'Attack on Titan Wings Patch', 'Accessories', 'Iron-on embroidered patch, 3 inches.', 'products/wall-rose-goods/wings-patch.webp', 800, 40, 5),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000d', 'Robotech Retro Mecha Tee', 'Apparel', 'Screen printed cotton tee.', 'products/wall-rose-goods/retro-mecha-tee.webp', 2800, 0, 2),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Attack on Titan Wall Maria Poster', 'Prints', '18 x 24 matte print.', 'products/pixel-forge-prints/wall-maria-poster.webp', 2500, 6, 3),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Cyberpunk 2077 Night City Print', 'Prints', '18 x 24 silkscreen print.', 'products/pixel-forge-prints/night-city-print.webp', 1800, 12, 3),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Chessex Black and Gold Dice Set', 'Tabletop', 'Seven-piece polyhedral set.', 'products/critical-hit-dice/black-gold-dice-set.webp', 3200, 8, 2),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000b', 'Black Dragon Dice Bag', 'Tabletop', 'Lined drawstring bag.', 'products/critical-hit-dice/black-dragon-dice-bag.webp', 1500, 1, 1),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000e', 'Tiny Mothra Plush', 'Plush', 'Eight inch plush.', 'products/soft-kaiju-plush/tiny-mothra-plush.webp', 2200, 10, 2),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000f', 'Wing Gundam Zero Model Kit', 'Figures', 'Limited 1/144 snap-fit walker. Only one at the show.', 'products/scout-regiment-figures/wing-gundam-zero-kit.webp', 8900, 1, 1),
  ('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000f', 'Survey Corps Shaker Keychain', 'Accessories', 'Acrylic shaker charm in Attack on Titan colors.', 'products/scout-regiment-figures/survey-corps-shaker-keychain.webp', 1200, 25, 4),
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000c', 'Star Wars Artist Sketch Card', 'Prints', 'Ask at the booth.', 'products/inkwell-artist-alley/star-wars-sketch-card.webp', 1000, 20, 1),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000e', 'Emotional Support Godzilla (Large)', 'Plush', 'Absorbs dread. Does not absorb deadlines.', 'products/soft-kaiju-plush/emotional-support-godzilla.webp', 3400, 5, 2),
  ('a0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-00000000000b', 'Cursed Jumbo d20', 'Tabletop', 'Guaranteed to roll a 1 when it matters. Returns not accepted; it will find its way back.', 'products/critical-hit-dice/cursed-jumbo-d20.webp', 666, 3, 1),
  ('a0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-00000000000d', 'Captain America Plot Armor (One Size Fits Main Characters)', 'Accessories', 'Protects against all named villains. Background characters, see manager.', 'products/wall-rose-goods/plot-armor-shield.webp', 4200, 4, 1),
  ('a0000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-00000000000b', 'Pet Rock in a Box, GM-Approved', 'Tabletop', 'Ideal for parties that keep asking what''s in the box.', 'products/critical-hit-dice/pet-rock-in-a-box.webp', 900, 0, 1);

-- Extra gallery photos, shown after the main one: the Mothra plush and the Godzilla plush from
-- the back, and the shield beside its box and the box's back. Every other product has one photo.
update public.products set image_paths = array['products/soft-kaiju-plush/tiny-mothra-plush-2.webp']
where id = 'a0000000-0000-0000-0000-000000000008';
update public.products set image_paths = array['products/soft-kaiju-plush/emotional-support-godzilla-2.webp']
where id = 'a0000000-0000-0000-0000-000000000012';
update public.products set image_paths = array[
  'products/wall-rose-goods/plot-armor-shield-2.webp',
  'products/wall-rose-goods/plot-armor-shield-3.webp'
]
where id = 'a0000000-0000-0000-0000-000000000014';

-- The prepay booth takes payment through a Square sandbox seller. The token lives in the
-- Edge Function secret with this name.
insert into public.provider_connections (vendor_id, provider, location_id, token_secret_name)
values ('f0000000-0000-0000-0000-00000000000b', 'square', 'LT26AY1A3MCK2', 'SQUARE_ACCESS_TOKEN_VENDOR_A');

-- ============================================================================================
-- Vendor staff logins, one per vendor: staff-<vendor-slug>@example.com.
--
-- LOCAL: with no staff passwords in Vault, every account gets the password 'demo-password'.
--
-- HOSTED (or any public project): before seeding, store one Vault secret per account, named
-- 'seed_staff_password:<email>', for example
--   select vault.create_secret('<strong password>', 'seed_staff_password:staff-snag@example.com');
-- Each account then takes its own password. If some secrets are set but not all, the seed stops,
-- so no hosted account falls back to the demo password. The secrets can be deleted after seeding;
-- only the password hashes are kept.
--
-- The token columns are empty strings, not null, or sign-in fails.
-- ============================================================================================
create temporary table seed_staff (id uuid primary key, email text not null, vendor_id uuid not null);
insert into seed_staff (id, email, vendor_id) values
  ('d0000000-0000-0000-0000-00000000000d', 'staff-wall-rose-goods@example.com', 'f0000000-0000-0000-0000-00000000000d'),
  ('d0000000-0000-0000-0000-00000000000a', 'staff-pixel-forge-prints@example.com', 'f0000000-0000-0000-0000-00000000000a'),
  ('d0000000-0000-0000-0000-00000000000b', 'staff-critical-hit-dice@example.com', 'f0000000-0000-0000-0000-00000000000b'),
  ('d0000000-0000-0000-0000-00000000000e', 'staff-soft-kaiju-plush@example.com', 'f0000000-0000-0000-0000-00000000000e'),
  ('d0000000-0000-0000-0000-00000000000f', 'staff-scout-regiment-figures@example.com', 'f0000000-0000-0000-0000-00000000000f'),
  ('d0000000-0000-0000-0000-00000000000c', 'staff-inkwell-artist-alley@example.com', 'f0000000-0000-0000-0000-00000000000c'),
  -- DibSpot's login keeps the address it had when the booth was named Snag: a hosted account uses it.
  ('d0000000-0000-0000-0000-000000000010', 'staff-snag@example.com', 'f0000000-0000-0000-0000-000000000010');

do $$
declare
  stored integer;
  matched integer;
begin
  select count(*) into stored from vault.secrets where name like 'seed_staff_password:%';
  select count(*) into matched from seed_staff s join vault.secrets v on v.name = 'seed_staff_password:' || s.email;
  if stored > 0 and matched <> (select count(*) from seed_staff) then
    raise exception 'seed: % of % staff accounts have a Vault password; set one for every account or none',
      matched, (select count(*) from seed_staff);
  end if;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated', s.email,
  extensions.crypt(
    coalesce(
      (select d.decrypted_secret from vault.decrypted_secrets d where d.name = 'seed_staff_password:' || s.email),
      'demo-password'
    ),
    extensions.gen_salt('bf')
  ),
  now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
from seed_staff s;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
join seed_staff s on s.id = u.id;

insert into public.vendor_staff (user_id, vendor_id)
select id, vendor_id from seed_staff;

drop table seed_staff;
