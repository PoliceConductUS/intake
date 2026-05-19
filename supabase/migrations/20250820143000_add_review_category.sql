alter table public.reviews
  add column if not exists category text;

update public.reviews
set category = 'tx'
where category is null;

alter table public.reviews
  alter column category set not null;
