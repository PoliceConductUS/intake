-- ReviewLink becomes a first-class intake entity (a review's external links —
-- news coverage, video, records). Give review_links a business key so curated
-- links converge by (review, url) via find-or-mint instead of duplicating on
-- re-run, and require the review a link belongs to (a link with no review is
-- meaningless). The table is otherwise unchanged from the initial schema.
alter table public.review_links
    alter column review_id set not null;

create unique index if not exists review_links_review_url_key
    on public.review_links (review_id, url);
