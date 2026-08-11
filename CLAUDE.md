# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
# Backend (Rust Axum, port 3001)
cd backend && cargo run

# Frontend (React + Vite, port 5173 — proxies /api and /ws to backend)
cd frontend && pnpm dev

# Desktop app (starts both frontend and Tauri window)
cargo tauri dev

# Type-check frontend
cd frontend && npx tsc

# Check all Rust code
cargo check --workspace
```

## Architecture

Monorepo with three packages: `backend/` (Rust), `frontend/` (React), `src-tauri/` (Tauri v2 desktop wrapper). Cargo workspace at root, pnpm workspace for frontend.

**Data flow:** Frontend ↔ WebSocket ↔ Axum backend (PostgreSQL-backed). REST is used for board creation (`POST /api/boards`), templates (`GET /api/templates`), labels, and the actions carry-over. All real-time sync happens via WebSocket at `/ws/boards/{id}`, broadcasting full board state on every mutation. Boards are persisted in PostgreSQL. A REST route that changes a board calls `routes::ws::broadcast_board_state` so that the open clients see the change.

**Backend state:** `AppState` holds a `PgPool` for database access and a parallel map of `tokio::sync::broadcast` channels (capacity 64) for WebSocket fan-out plus in-memory participant tracking.

**Frontend state:** Zustand store (`boardStore.ts`) holds board, participantId, isFacilitator, isConnected, sortMode. The `useWebSocket` hook connects on mount, sends Join with name + optional facilitator token from `sessionStorage`, and dispatches server messages to the store. Auto-reconnects on close (2s delay).

**Auth model:** No accounts. Facilitator gets a `facilitator_token` on board creation, stored in `sessionStorage`. Only the facilitator can toggle blur. Authors can edit/delete their own tickets. Anyone can vote (idempotent toggle via HashSet).

## WebSocket Protocol

Messages are serde-tagged enums: `#[serde(tag = "type", content = "payload")]`. TypeScript mirrors this as discriminated unions in `lib/types.ts`.

Client → Server: `Join`, `AddTicket`, `RemoveTicket`, `EditTicket`, `ToggleVote`, `ToggleBlur`, `AddComment`, `EditComment`, `RemoveComment`, `SetTicketDone`, `SetRockStatus`, `RateMeeting`, `AddScorecardMetric`, `UpdateScorecardMetric`, `RemoveScorecardMetric`
Server → Client: `BoardState` (after every mutation), `Authenticated` (after Join), `Error`

`AddTicket`, `EditTicket`, `AddComment` and `EditComment` each carry an optional `gif`. The client sends the whole state it wants, so an edit that leaves `gif` out takes the picture off the card.

## Column Roles and Actions Carry-Over

Every board has two columns with a `role` in the `columns` table: `previous_actions` (first) and `actions` (last). A unique partial index keeps one column of each role per board. All other columns have `role = NULL` and keep their free-text names. Templates must not supply an action column — `create_board` drops a requested column that uses one of `RESERVED_COLUMN_NAMES` (`models.rs`).

A third role, `rocks`, belongs to Level 10 boards alone. Only the `level10` creation path assigns it: the first requested column whose trimmed name reads "rocks", in any case, takes `ROLE_ROCKS`. The name stays free text everywhere else — `RESERVED_COLUMN_NAMES` does not hold "rocks", so the Rocks column of the Sailboat template keeps `role = NULL` and carries no rock status.

The facilitator or an editor copies the actions of any other board into Previous Actions:

- `GET /api/boards/{id}/action-sources?q=&labels=` lists the boards that hold at least one action card, newest first. `labels` is comma-separated and matches any.
- `POST /api/boards/{id}/actions/import` with `{ source_board_id, facilitator_token?, participant_id? }` copies them. `db::copy_actions` skips a card whose text is already there, so a second copy adds nothing. Votes do not move. The new cards keep `carried_from_board_id` and `carried_from_board_title`, which the card shows as its source.
- `PUT /api/boards/{id}/labels` and `GET /api/labels` manage the board labels. Labels are free text, kept lower case, six per board at most (`normalize_labels` in `models.rs`).

REST carries these three, not the WebSocket protocol, because each one answers the caller with a result or an error. `db::is_board_privileged` applies the same rule as the WebSocket handler: facilitator token, facilitator cookie, or a place in the editor list.

## Closing an Action

An action that is finished stays on the board. `tickets.done_at` holds when it was closed, or
NULL while it is open; the time, not a flag, so a card can say when the team shut it. `SetTicketDone`
asks the author or a privileged user, and the server refuses a card that does not sit in a column
whose role is one of `DONE_COLUMN_ROLES` (`models.rs`) — `actions` or `previous_actions`. Every
board has both, so the same check that keeps the mark on actions also keeps one board out of the
cards of another. An observation is never finished, so a free-text column reads NULL forever.

- **A done action is carried done.** `copy_actions` brings `done_at` across with the card, because
  Previous Actions is the record of the last retro and the record has to say which of the actions
  the team closed. A split leaves the new card open, and a merge keeps the mark of the target and
  puts the mark of the source in `MergeSnapshot`, as it does with the rock status.
- **The mark is not redacted.** A blurred card carries no done control, the rule the comment and
  the rock controls follow, but `done_at` itself goes out whole.
- **On the card** the closed action takes a green edge in place of the color of its column, a wash
  of the same green mixed into whichever paper it sits on, and lower opacity that lifts on hover.
  Both action columns have a fixed color, so the swapped edge costs no information.

## Opening a Card

A column is narrow, so a card on the board says as little as it can. `TicketModal` holds the rest:
the whole of a long card, the parts of a merged one set apart with a rule and a **Split out** control
each, the meta line, and the conversation. Clicking the card opens it; so does the comment mark in
the footer, which then puts the caret in the composer. A blurred card does not open.

- **The comments live here alone.** A card on the board carries the count and none of the words.
- The panel keeps the colored edge of the card as a spine down its whole height, and takes the
  eyebrow of its column — the dot and the name, as the column header has them.
- Escape closes it, so does the backdrop; the page behind is held still, Tab runs a ring inside the
  panel, and focus goes back where it came from. The scrim is `--color-scrim`, which darkens on both
  papers: a light veil over a dark board reads as fog rather than as depth.
- `useTicketPermissions` answers who may do what. The card and the modal ask the same question of
  the same board, so the two never disagree. `TicketEditor` is the one edit field both of them open.

## Level 10 Boards

`boards.template_id` holds the template the board came from, or NULL. It has no foreign key:
`create_board` checks the id against the `templates` table once, at creation, and keeps it only if
the row is there. From then on the value is a frozen tag, so admin CRUD can change or delete a
template without touching the boards already made from it. `TEMPLATE_LEVEL10` (`"level10"` in
`models.rs`) turns on the three Level 10 features; every other board carries none of them.
`db::get_board` reads the scorecard and the ratings only for a Level 10 board, so a broadcast on a
normal board makes no extra queries.

- **The scorecard** is `scorecard_metrics(id, board_id, name, goal, actual, on_track, position)`.
  `goal` and `actual` are text, because an EOS goal reads "≥ 95%" or "$120k". `on_track` is
  nullable and thus three-state — on, off, or not said yet — and a person sets it, nothing computes
  it. Only the facilitator or an editor writes it, over the WebSocket (`AddScorecardMetric`,
  `UpdateScorecardMetric`, `RemoveScorecardMetric`), because the rebroadcast is the answer, as with
  `SetVoteLimit`. The board id sits in the WHERE of the update and of the delete, which is what
  keeps one board out of the scorecard of another.
- **The rating** is `meeting_ratings(board_id, participant_id, rating)`, keyed on the pair.
  `RateMeeting` takes 1 to 10 from any participant and replaces the mark that participant left
  before. The raw pairs go out on `BoardState`, as the votes do, and the client works out the
  average, the count, and which mark is yours. There is no conclude phase: the widget stays in the
  header for the whole meeting.
- **The rock status** is `tickets.rock_status` — `on_track`, `off_track`, or NULL. `SetRockStatus`
  asks the author or a privileged user, and the server refuses a card that does not sit in the
  `rocks` column of this board, which confines the feature to Level 10 boards with no second check.
  A merge keeps the mark of the target card and puts the mark of the source in `MergeSnapshot`, so
  the undo returns it. A split leaves the new card unmarked, and a carried action arrives unmarked,
  because `copy_actions` names the columns it copies.
- **None of the three is redacted.** `redact_hidden_for` masks the words of a hidden card in the
  Rocks column as it does anywhere else, but the scorecard, the ratings and the marks go out whole.
  The card hides its rock-status control while it is blurred for you, the rule the comment control
  follows.
- **The template row can go.** Delete `level10` from `templates` and a new board falls back to
  `template_id = NULL`: no Rocks role, and the three features off. The boards already made keep
  theirs, and nothing breaks — the next Level 10 board is a plain board with those column names.

## GIFs from GIPHY

A card or a comment can carry one GIF. The writer types `/gif` and what to search for in any
composer, and a pane opens under it and searches GIPHY as they type: the composer is the search
field, so the pane holds no search box of its own. Picking a GIF takes the command back out of the
draft. `utils/gifCommand.ts` reads the command, which has to sit at the end of the draft.

- **The key** arrives from a Kubernetes secret (`giphy-api-key` in the chart Secret, read as
  `GIPHY_API_KEY`) and reaches the browser at `GET /api/config`. The GIPHY web SDK calls GIPHY
  from the client, so the key cannot stay on the server; the secret keeps it out of the image and
  out of git, not out of the browser. Use a domain-restricted key. No key set means no GIF
  controls at all, in every composer.
- **The SDK** (`@giphy/react-components`) sits in the pane alone, which `useGifComposer` loads
  with `React.lazy`. A retro that uses no GIFs loads none of that code.
- **The database** holds six columns per GIF on `tickets` and on `ticket_comments`: the id, the
  moving URL, the still URL, the natural width and height, and the title. A card draws the picture
  from those, with no second call to GIPHY. `db::TICKET_COLUMNS` and `db::COMMENT_COLUMNS` keep the
  read list in one place.
- **The URL is checked** by `models::sanitize_gif`, which refuses anything that is not HTTPS on
  `giphy.com` or a subdomain. The client chooses the URL, so an open field here would let anyone
  put a picture of their own on someone else's board.
- **A GIF is a whole remark.** A comment with a GIF and no words is allowed; a card is too. Both
  refuse to be empty of words *and* picture.
- **A hidden GIF** takes `blur(16px) saturate(0.35)`, heavier than the 8px on text, and its caption
  reads "Hidden". Blurred words are unreadable at once, but a picture keeps its shape and colours
  and a known GIF is recognisable from those alone.
- **A card rests on the still frame** and moves on hover or focus. A board of GIFs all moving at
  once is unreadable, and `prefers-reduced-motion` keeps the pane and the card still.
- **A merge** hands the source GIF over only when the target has none, and the undo puts both back.
  A split leaves the GIF on the original card. A carried action keeps its GIF.

## Key Conventions

- **Vite proxy:** `/api` and `/ws` routes proxy to `localhost:3001` in dev (`vite.config.ts`), so both web and Tauri use relative URLs. `VITE_API_URL` env var overrides for production.
- **Column colors** are hex strings in `COLUMN_COLORS` array (`lib/types.ts`), passed as props to Column/Ticket components and applied via inline `style`. The two role columns take their own colors from `COLUMN_ROLE_COLORS`; `utils/columnColors.ts` runs the sticky colors across the other columns only.
- **Previous Actions cards** never blur and take no votes. They are a record of the last retro, not fresh input.
- **Comments** live in the card modal, set as notes in the margin: a pen mark in the color of the
  column, the remark, and the writer signed under it. The card on the board carries the count only,
  on the mark in its footer that opens the card. A card that is blurred for you shows no comment
  control, because you cannot read the card yet. Anyone can comment, the writer can edit, and the
  writer, the facilitator, or an editor can delete. A merge moves the comments of the source card
  onto the target card, and an undo sends them back.
- **Card rotation** is seeded from ticket ID hash (deterministic, -1° to 1°).
- **Blur** is CSS `filter: blur(8px)` with 500ms transition. Authors always see their own cards.
- **A hidden card holds no words on the client.** The blur is a picture, not a lock: a reader who
  opens the network panel reads through it. So `BoardView::redact_hidden_for` puts filler in the
  place of the text of every card the reader may not read yet, and of the author name and the
  comments with it. `models::mask_text` keeps the shape — same characters, same spaces, same line
  breaks — so the board under the blur looks as it always did. GIFs go out whole, because the
  browser hides the picture and a card that lost it would change shape when the board opens.
  The reader keeps their own cards, the carried actions, and everything on a board that is open;
  the facilitator and the editors keep it all, which is what makes the peek work.
  The redaction sits on the way out to each client, not in the broadcast: `routes/ws.rs` runs it
  in the per-client send task and on the first state after Join, and `GET /api/boards/{id}` runs
  it too, since that route names no participant and would otherwise hand over the whole board.
- **Sorting** is client-side only (not synced): "newest" or "most-votes" in `utils/sort.ts`.
- **Tailwind v4** with `@theme` block in `global.css` for custom properties. Fonts loaded via Google Fonts `<link>` in `index.html`.
