-- Give two columns of every board a known role, so that actions can move between boards.
-- This migration only adds columns and rows. It deletes no data.

ALTER TABLE columns ADD COLUMN role TEXT;

-- Adopt one action-style column of each board as the Actions column. The name does not change.
UPDATE columns c SET role = 'actions'
FROM (
    SELECT DISTINCT ON (board_id) id FROM columns
    WHERE lower(btrim(name)) IN ('action items', 'action item', 'actions')
    ORDER BY board_id, position
) pick
WHERE c.id = pick.id;

-- Make space at the start of every board for the Previous Actions column.
UPDATE columns SET position = position + 1;

INSERT INTO columns (id, board_id, name, position, role)
SELECT gen_random_uuid()::text, b.id, 'Previous Actions', 0, 'previous_actions' FROM boards b;

-- Add an Actions column to the boards that have no action-style column.
INSERT INTO columns (id, board_id, name, position, role)
SELECT gen_random_uuid()::text, b.id, 'Actions',
       COALESCE((SELECT MAX(c.position) + 1 FROM columns c WHERE c.board_id = b.id), 0), 'actions'
FROM boards b
WHERE NOT EXISTS (SELECT 1 FROM columns c WHERE c.board_id = b.id AND c.role = 'actions');

CREATE UNIQUE INDEX idx_columns_board_role ON columns (board_id, role) WHERE role IS NOT NULL;

-- Record the board that supplied each carried action.
ALTER TABLE tickets ADD COLUMN carried_from_board_id TEXT;
ALTER TABLE tickets ADD COLUMN carried_from_board_title TEXT;

-- Labels group the boards, for example 'sprint retro'.
CREATE TABLE board_labels (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    PRIMARY KEY (board_id, label)
);

CREATE INDEX idx_board_labels_label ON board_labels(label);

-- Each board now gets an Actions column. The template must not supply a second one.
UPDATE templates SET columns = '{"Went Well","To Improve"}' WHERE id = 'classic';
