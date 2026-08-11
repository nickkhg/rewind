-- Let a board ask for a password before it opens.
--
-- A board link is the only key a board has: anyone who holds it reads the retro. A team that
-- talks about pay, or people, or an incident wants a second key. `password_hash` holds an Argon2
-- hash of the word the facilitator chose, in the form the admin token uses. NULL means the board
-- is open, which is what every board made before this migration is.
--
-- `access_token` is what a reader gets back for the right password, and what the reader sends on
-- the next request. The password itself stays in the browser for no longer than the form takes:
-- one Argon2 check at the gate, then a token for the rest of the meeting. The token also gives
-- the facilitator a way to shut the board again — a new password writes a new token, and every
-- reader who kept the old one has to ask again.

ALTER TABLE boards ADD COLUMN password_hash TEXT;
ALTER TABLE boards ADD COLUMN access_token TEXT;

-- Every board carries a token, whether or not it carries a password, so that one code path
-- serves both. The value of an open board is never read.
UPDATE boards SET access_token = md5(random()::text || id) WHERE access_token IS NULL;

ALTER TABLE boards ALTER COLUMN access_token SET NOT NULL;
