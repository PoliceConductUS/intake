-- Set user_id for all existing reviews
UPDATE public.reviews
SET user_id = 'ccce35fb-938c-4c94-8724-492367b17ce5'
WHERE user_id IS NULL;

-- Make user_id NOT NULL
ALTER TABLE public.reviews
ALTER COLUMN user_id SET NOT NULL;

-- Update the foreign key constraint to ON DELETE RESTRICT (since NULL is no longer allowed)
ALTER TABLE public.reviews
DROP CONSTRAINT reviews_user_id_fkey;

ALTER TABLE public.reviews
ADD CONSTRAINT reviews_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
