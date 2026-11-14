-- Extra photos of a product for the storefront gallery (other angles, the box), as paths in the
-- 'assets' bucket like image_path. image_path stays the main photo; image_paths holds the rest in
-- display order and is empty for a product with one photo. Reads need no new grant: select on
-- products is already granted to anon and authenticated.
alter table public.products
  add column image_paths text[] not null default '{}';

-- Like image_path, no element may be missing or empty, so every entry is a usable path.
alter table public.products
  add constraint products_image_paths_present
  check (array_position(image_paths, null) is null and '' <> all (image_paths));
