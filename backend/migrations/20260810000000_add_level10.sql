-- Let a board run an EOS Level 10 meeting.
--
-- A board now remembers the template it started from. The Level 10 parts — the scorecard, the
-- rock status on a card, and the meeting rating — switch on for the boards that hold 'level10'
-- and stay out of the way of every other board.

ALTER TABLE boards ADD COLUMN template_id TEXT;
ALTER TABLE tickets ADD COLUMN rock_status TEXT;

-- The scorecard: one row for each number the team reads each week.
-- Goal and actual are free text, because an EOS goal reads '>= 95%' or '$120k'.
CREATE TABLE scorecard_metrics (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    actual TEXT NOT NULL DEFAULT '',
    on_track BOOLEAN,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_scorecard_metrics_board ON scorecard_metrics(board_id);

-- The conclude rating: one mark from 1 to 10 for each participant. A new mark replaces the old one.
CREATE TABLE meeting_ratings (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    PRIMARY KEY (board_id, participant_id)
);

-- An admin can make a template with any id, so a 'level10' row may already exist. The insert
-- steps aside then: a duplicate key here stops the migration and the server with it.
INSERT INTO templates (id, name, description, columns, position) VALUES
  ('level10', 'Level 10', 'EOS weekly Level 10 meeting', '{"Segue","Headlines","Rocks","IDS"}', 6)
ON CONFLICT (id) DO NOTHING;
