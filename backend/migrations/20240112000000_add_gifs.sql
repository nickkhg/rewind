-- Let a card or a comment carry one GIF from GIPHY.
-- The picture sits beside the text, so a card keeps its words when the GIF goes away.
--
-- The columns hold what the board needs to draw the GIF without a call to GIPHY:
--   gif_id        the GIPHY id, which the attribution link points at
--   gif_url       the moving picture
--   gif_still_url the first frame, which a card shows until the reader asks for motion
--   gif_width     natural width, which reserves the space before the picture arrives
--   gif_height    natural height, same reason
--   gif_title     the GIPHY title, which becomes the alt text

ALTER TABLE tickets
    ADD COLUMN gif_id TEXT,
    ADD COLUMN gif_url TEXT,
    ADD COLUMN gif_still_url TEXT,
    ADD COLUMN gif_width INTEGER,
    ADD COLUMN gif_height INTEGER,
    ADD COLUMN gif_title TEXT;

ALTER TABLE ticket_comments
    ADD COLUMN gif_id TEXT,
    ADD COLUMN gif_url TEXT,
    ADD COLUMN gif_still_url TEXT,
    ADD COLUMN gif_width INTEGER,
    ADD COLUMN gif_height INTEGER,
    ADD COLUMN gif_title TEXT;
