create table public.personnel_photo (
    id text primary key,
    personnel_id text not null unique references public.personnel (id) on delete restrict,
    workspace_path text not null check (char_length(btrim(workspace_path)) > 0),
    sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    content_type text not null check (content_type = any (array['image/webp', 'image/png', 'image/jpeg', 'image/avif'])),
    byte_size integer not null check (byte_size > 0),
    source_filename text not null check (char_length(btrim(source_filename)) > 0),
    source_url text check (char_length(btrim(source_url)) > 0),
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);
