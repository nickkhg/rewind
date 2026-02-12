CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    is_blurred BOOLEAN NOT NULL DEFAULT TRUE,
    facilitator_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
);

CREATE INDEX idx_columns_board_id ON columns(board_id);

CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tickets_column_id ON tickets(column_id);

CREATE TABLE IF NOT EXISTS votes (
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    PRIMARY KEY (ticket_id, participant_id)
);
