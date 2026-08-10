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

Client → Server: `Join`, `AddTicket`, `RemoveTicket`, `EditTicket`, `ToggleVote`, `ToggleBlur`, `AddComment`, `EditComment`, `RemoveComment`
Server → Client: `BoardState` (after every mutation), `Authenticated` (after Join), `Error`

`AddTicket`, `EditTicket`, `AddComment` and `EditComment` each carry an optional `gif`. The client sends the whole state it wants, so an edit that leaves `gif` out takes the picture off the card.

## Column Roles and Actions Carry-Over

Every board has two columns with a `role` in the `columns` table: `previous_actions` (first) and `actions` (last). A unique partial index keeps one column of each role per board. All other columns have `role = NULL` and keep their free-text names. Templates must not supply an action column — `create_board` drops a requested column that uses one of `RESERVED_COLUMN_NAMES` (`models.rs`).

The facilitator or an editor copies the actions of any other board into Previous Actions:

- `GET /api/boards/{id}/action-sources?q=&labels=` lists the boards that hold at least one action card, newest first. `labels` is comma-separated and matches any.
- `POST /api/boards/{id}/actions/import` with `{ source_board_id, facilitator_token?, participant_id? }` copies them. `db::copy_actions` skips a card whose text is already there, so a second copy adds nothing. Votes do not move. The new cards keep `carried_from_board_id` and `carried_from_board_title`, which the card shows as its source.
- `PUT /api/boards/{id}/labels` and `GET /api/labels` manage the board labels. Labels are free text, kept lower case, six per board at most (`normalize_labels` in `models.rs`).

REST carries these three, not the WebSocket protocol, because each one answers the caller with a result or an error. `db::is_board_privileged` applies the same rule as the WebSocket handler: facilitator token, facilitator cookie, or a place in the editor list.

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
- **Comments** hang under a card in a recessed strip that opens from the footer mark. A card that
  is blurred for you shows no comment control, because you cannot read the card yet. Anyone can
  comment, the writer can edit, and the writer, the facilitator, or an editor can delete. A merge
  moves the comments of the source card onto the target card, and an undo sends them back.
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
