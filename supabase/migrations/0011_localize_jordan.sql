-- The platform now targets Jordan instead of Saudi Arabia: city keys and
-- default timezone move accordingly (currency is a display-only string in
-- src/lib/i18n.ts, no schema change needed for it).

alter table public.org_settings
  alter column timezone set default 'Asia/Amman';

-- Every org so far was created under the old Saudi-market default —
-- move them to Jordan time too.
update public.org_settings
set timezone = 'Asia/Amman'
where timezone = 'Asia/Riyadh';

-- Remap any organizations already tagged with an old Saudi city key to a
-- Jordanian one. All of this platform's real data so far is the one demo
-- org (test-clinic-smoketest, city='riyadh'); the full CASE list is just
-- defensive in case more test data was created with other keys.
update public.organizations
set city = case city
  when 'riyadh' then 'amman'
  when 'jeddah' then 'amman'
  when 'makkah' then 'amman'
  when 'madinah' then 'amman'
  when 'dammam' then 'zarqa'
  when 'khobar' then 'zarqa'
  when 'taif' then 'salt'
  when 'buraidah' then 'mafraq'
  when 'abha' then 'karak'
  when 'tabuk' then 'irbid'
  else city
end
where city in ('riyadh', 'jeddah', 'makkah', 'madinah', 'dammam', 'khobar', 'taif', 'buraidah', 'abha', 'tabuk');
