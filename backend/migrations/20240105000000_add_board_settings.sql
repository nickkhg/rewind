-- Add vote limit and timer columns to boards
ALTER TABLE boards ADD COLUMN vote_limit_per_column INTEGER;
ALTER TABLE boards ADD COLUMN timer_end TIMESTAMPTZ;
