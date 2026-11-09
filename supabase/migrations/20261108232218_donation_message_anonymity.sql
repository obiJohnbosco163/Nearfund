ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS message text
    CHECK (message IS NULL OR char_length(message) <= 280),
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;