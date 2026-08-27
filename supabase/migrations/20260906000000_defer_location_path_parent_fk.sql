-- location_path.parent_location_path_id is self-referential. The import batches
-- creates by column signature, so location_paths land in several inserts and a
-- child's batch can run before its parent's — a non-deferrable FK then fails.
-- Make the self-FK DEFERRABLE INITIALLY DEFERRED so it is checked once at commit,
-- by which point every level is present. This makes a fresh bulk load / replay
-- (ADR 0033) order-independent for the self-reference.

alter table public.location_path
  drop constraint if exists location_path_parent_location_path_id_fkey;

alter table public.location_path
  add constraint location_path_parent_location_path_id_fkey
    foreign key (parent_location_path_id)
    references public.location_path (location_path_id)
    deferrable initially deferred;
