-- Let a template say how the board it makes starts.
--
-- A retro starts blurred, because the team writes before it reads: cards that are visible while
-- people write pull the room towards the first thing said. A Level 10 meeting is not that meeting.
-- It works a list the whole room reads together — the scorecard, the rocks, the headlines — so it
-- starts with the cards open, and the blur would only be one more thing for the facilitator to
-- turn off at the top of every week.
--
-- The column holds the default of the template, not the state of a board. `boards.is_blurred`
-- keeps the state, the facilitator changes it, and nothing here follows the board afterwards.

ALTER TABLE templates ADD COLUMN default_blurred BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE templates SET default_blurred = FALSE WHERE id = 'level10';
