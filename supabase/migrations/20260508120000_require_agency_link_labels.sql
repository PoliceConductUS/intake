alter table public.agency_links
  add column if not exists label text;

update public.agency_links
set label = case
  when url ~* '(^|//)(www\.)?youtube\.com/' then 'YouTube'
  when url ~* '(^|//)(www\.)?facebook\.com/' then 'Facebook'
  when url ~* '(^|//)(www\.)?(twitter|x)\.com/' then 'X'
  when url ~* '(^|//)(www\.)?instagram\.com/' then 'Instagram'
  else 'Website'
end
where label is null or btrim(label) = '';

alter table public.agency_links
  alter column label set not null;

comment on column public.agency_links.label is
  'Short display label for the agency link. The URL remains the href.';
