-- Let an action be marked done instead of deleted.
--
-- An action that is finished used to leave the board with a delete, and the record of it went
-- with it. The mark keeps the card: the next retro reads what the team said it would do and
-- what it did. The column holds the time, not a flag, so a card can say when it was closed.
--
-- Only a card in the Actions or the Previous Actions column carries the mark. Every other
-- column reads NULL, as it always did.

ALTER TABLE tickets ADD COLUMN done_at TIMESTAMPTZ;
