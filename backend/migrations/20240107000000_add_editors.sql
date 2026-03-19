-- Editor requests (pending, deleted on approve/decline)
CREATE TABLE editor_requests (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, participant_id)
);

-- Approved editors (persists across reconnects)
CREATE TABLE board_editors (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    PRIMARY KEY (board_id, participant_id)
);
