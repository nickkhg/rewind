ALTER TABLE boards ADD COLUMN facilitator_id TEXT;
CREATE INDEX idx_boards_facilitator_id ON boards(facilitator_id);
