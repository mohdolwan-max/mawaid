-- New static routes for the password-reset flow (src/app/forgot-password,
-- src/app/reset-password) must never be claimable as an org slug, same
-- reasoning as every other reserved_slugs insert (0001_init.sql, 0006_directory.sql).
insert into public.reserved_slugs (slug) values
  ('forgot-password'), ('reset-password')
on conflict do nothing;
