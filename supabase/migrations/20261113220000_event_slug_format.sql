-- An event's slug is the address of its page (/e/<slug>), printed in links and QR codes.
-- Lowercase letters and digits, with single hyphens between them.
alter table public.events
  add constraint events_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
