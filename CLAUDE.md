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

**Data flow:** Frontend ↔ WebSocket ↔ Axum backend (PostgreSQL-backed). REST is used for board creation (`POST /api/boards`), templates (`GET /api/templates`), labels, the board title, the carry-over, and the board password. All real-time sync happens via WebSocket at `/ws/boards/{id}`, broadcasting full board state on every mutation. Boards are persisted in PostgreSQL. A REST route that changes a board calls `routes::ws::broadcast_board_state` so that the open clients see the change.

**Backend state:** `AppState` holds a `PgPool` for database access and a parallel map of `tokio::sync::broadcast` channels (capacity 64) for WebSocket fan-out plus in-memory participant tracking.

**Frontend state:** Zustand store (`boardStore.ts`) holds board, participantId, isFacilitator, isConnected, sortMode. The `useWebSocket` hook connects on mount, sends Join with name + optional facilitator token from `sessionStorage`, and dispatches server messages to the store. Auto-reconnects on close (2s delay).

**Auth model:** No accounts. Facilitator gets a `facilitator_token` on board creation, stored in `sessionStorage`. Only the facilitator can toggle blur. The author, the facilitator, or an editor can edit or delete a ticket. Anyone can vote (idempotent toggle via HashSet). A board can also ask for a password, which the server checks before it hands the board to anyone (see Password-Protected Boards). A deployment can put the whole server behind a work account as well (see Signing In with Entra), which says who a person is and nothing about what they may do.

## WebSocket Protocol

Messages are serde-tagged enums: `#[serde(tag = "type", content = "payload")]`. TypeScript mirrors this as discriminated unions in `lib/types.ts`.

Client → Server: `Join`, `AddTicket`, `RemoveTicket`, `EditTicket`, `ToggleVote`, `ToggleBlur`, `AddComment`, `EditComment`, `RemoveComment`, `SetTicketDone`, `SetRockStatus`, `RateMeeting`, `AddScorecardMetric`, `UpdateScorecardMetric`, `RemoveScorecardMetric`
Server → Client: `BoardState` (after every mutation), `Authenticated` (after Join), `PasswordRequired` (the gate of a locked board; the socket closes after it), `Error`

`Join` carries an optional `access_token`, the key a reader got for the password of a locked board.

`AddTicket`, `EditTicket`, `AddComment` and `EditComment` each carry an optional `gif`. The client sends the whole state it wants, so an edit that leaves `gif` out takes the picture off the card.

## Column Roles and the Carry-Over

Every board has two columns with a `role` in the `columns` table: `previous_actions` and `actions` (last, always). A unique partial index keeps one column of each role per board. All other columns have `role = NULL` and keep their free-text names. Previous Actions is placeable: a template or a custom board that names "previous actions", in any case, puts the column at that slot, with the canonical name and the role, and only the first mention counts. A list that never names it gets it first, as every board once did. Only the Actions names stay reserved — `models::plan_new_board_columns` plans all of this, drops a requested column that uses one of `RESERVED_COLUMN_NAMES` (`models.rs`), and appends Actions last.

A third role, `rocks`, belongs to Level 10 boards alone. Only the `level10` creation path assigns it: the first requested column whose trimmed name reads "rocks", in any case, takes `ROLE_ROCKS`. The name stays free text everywhere else — `RESERVED_COLUMN_NAMES` does not hold "rocks", so the Rocks column of the Sailboat template keeps `role = NULL` and carries no rock status.

The facilitator or an editor copies cards from any column of any other board into any column of
this one. The actions of a retro go to Previous Actions, as they always did; the items a Level 10
team did not close come back to the same column of the next meeting.

- `GET /api/boards/{id}/action-sources?q=&labels=` lists the boards that hold at least one card, in any column, newest first. `labels` is comma-separated and matches any. The row carries `action_count` and `card_count`.
- `POST /api/boards/{id}/actions/import` with `{ source_board_id, source_column_id?, target_column_id?, facilitator_token?, participant_id? }` copies them. Naming no column keeps the old behaviour: Actions there into Previous Actions here. A column id is read only when it sits on the board named beside it, because the board is what the password and the editor list are checked against. `db::copy_cards` skips a card whose text is already in the target column, so a second copy adds nothing. Votes and rock status do not move. A done mark comes across only into a column whose role is one of `DONE_COLUMN_ROLES`, so a closed action carried into a free-text column arrives open. The new cards keep `carried_from_board_id` and `carried_from_board_title`, which the card shows as its source — and which also keeps them out of the blur, as a carried action has always been.
- `PUT /api/boards/{id}/labels` and `GET /api/labels` manage the board labels. Labels are free text, kept lower case, six per board at most (`normalize_labels` in `models.rs`).
- `PUT /api/boards/{id}/title` renames a board, under the same privileged check as the labels: renaming is editing, so an editor may do it, unlike the password. `read_title` in `models.rs` trims the name and refuses an empty one, at creation and at a rename alike. The header shows the field to the facilitator and the editors — a click on the name, or the pencil beside it — and the saved name comes back on the broadcast, so the client writes nothing into the store itself.

**A board is a copy of its template, not a view of it.** `create_board` reads the column names
once and writes rows to `columns`; from then on the template can be renamed, re-columned or
deleted and the board never notices. `POST /api/admin/templates/{id}/apply` is the one route that
reaches back. It deletes nothing, so no card is ever lost by an apply and a board keeps a column
the template no longer names. Each changed board is rebroadcast, because a board open in
someone's browser holds the old columns until it is told otherwise. The admin reads the counts
back: `{ boards_examined, boards_changed, columns_renamed, columns_added, columns_moved }`.

**The names take the columns in passes, and the order matters.** First by role: a name that
reads "Previous Actions" takes the board's own `previous_actions` column, wherever the template
put the name — matched by role and never made anew, so an apply *moves* the column and no board
ever gets a second one, which the unique index would refuse. A template that does not name it
leaves it where it sits. Then by name: a name the board already has takes that column wherever
it stands, which is what carries an *order* across. Then by position: the names that matched
nothing take the columns that matched nothing, in the order both are in, which is what carries
a *rename* across ("Segue" becomes "Solved" and keeps its cards). A name still without a column
becomes one. Name before position is what stops a reordered template from renaming the columns
under the cards of a board. A name added as "rocks" on a Level 10 board takes `ROLE_ROCKS`, as
it would at creation, and Actions stays last. The plan is pure (`db::plan_template_apply`, with
its tests beside it) and the SQL runs from what it says.

**Column order lives in the template.** The admin form holds the list, with a number and a pair
of arrows on each row, and "Apply to boards" carries the order to the boards already made. A
board has no reorder control of its own: `columns.position` is written by `create_board` and by
an apply, and by nothing else.

REST carries these three, not the WebSocket protocol, because each one answers the caller with a result or an error. `db::is_board_privileged` applies the same rule as the WebSocket handler: facilitator token, facilitator cookie, or a place in the editor list.

## Password-Protected Boards

A board link is the only key a board has, so a board that talks about pay, or people, or an
incident can ask for a second one. `boards.password_hash` holds an Argon2 hash of the word the
facilitator chose — the same algorithm and the same crate as `ADMIN_TOKEN_HASH`, in one place now
(`password.rs`), which the admin extractor also calls. NULL means the board is open, which every
board made before the migration is. The hash work runs on `spawn_blocking`, because Argon2 spends
tens of milliseconds of CPU on purpose and a board password is checked at every gate.

- **The password buys a key, and the key does the rest.** `boards.access_token` is a nanoid that
  `POST /api/boards/{id}/unlock` gives back for the right password. The browser keeps the key in
  `sessionStorage` (`board_access_{id}`), and sends it on the `X-Board-Access` header for REST and
  in the `Join` for the socket. The password itself is never stored on the client. A change of
  password writes a new key, so the readers who hold the old one are asked again; the sockets that
  are already joined stay joined, because a change is meant to keep the next reader out and not to
  throw the room out.
- **The server holds the gate, not the browser.** `GET /api/boards/{id}` answers 401 without the
  key, and the WebSocket answers `PasswordRequired` and closes before the participant is counted.
  A locked board hands over its title, whether it is locked, and whether it asks for a name —
  `GET /api/boards/{id}/access`, which is what the gate draws itself from. Nothing that is on the
  board goes with it.
- **The facilitator needs no key.** The facilitator token and the facilitator cookie open the
  board as they always did, and the person who set the password gets the key with the board at
  creation. `PUT /api/boards/{id}/password` sets, changes or removes it, and takes the facilitator
  alone: an editor may write on a board, but the lock on it belongs to whoever called the meeting.
- **A carried action asks the source board.** A locked board is named in
  `GET /api/boards/{id}/action-sources` with `is_locked`, and the copy asks for its password:
  `import_actions` runs the same read check on the source that `GET /api/boards/{id}` runs. Being
  the facilitator of the target board says nothing about the source. Nobody is asked twice —
  a caller who runs the source board, or who opened it earlier in the session, holds the key
  already. Two boards with the same password hold two different hashes, because every hash carries
  its own salt, so the answer to "is it the same password" is always "can you open it".
- **The gate stands before the name.** A person who cannot open the board is never asked who
  they are.

## Signing In with Entra

A board link is the key to a board, and a board password is a second one, but both are things a
person holds rather than someone a person is. A company that runs every other tool behind its
directory wants this one there too. So a deployment can name an Entra app registration —
`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, from the chart Secret — and the server
then puts the whole of itself behind a work account: the REST routes, the socket, and the built
frontend it serves. Name none of the three and nothing changes, which is what `cargo run` and the
desktop app rely on. Name one or two and the server stops, because an operator who set a client id
meant to put a door here and a server that started anyway would serve every board to anyone while
looking configured.

`auth.rs` holds all of it. The OIDC authorization code flow with PKCE runs on the server, so the
client secret stays in the pod; what the browser holds is one cookie this server wrote.

- **The gate stands outside everything.** `auth::gate` is a middleware, not an extractor, so it
  covers the static files as well as the routes — a browser asking for a page while signed out is
  sent to Entra before it is sent the bundle. It answers by what the caller asked for: a `GET` that
  wants `text/html` is redirected, and everything else — a `fetch`, the socket handshake, the
  desktop app — gets 401 with the path to the door in the body, because a redirect to Microsoft is
  nothing a `fetch` can act on. Two routes stand outside the gate: `/api/auth/*`, which is the door,
  and `/api/health`, which is why the Kubernetes probes read that one and not `/api/templates`.
- **The session is a cookie and nothing else.** `rewind_session` holds the `Identity` — subject,
  display name, UPN, and when it runs out — in a `PrivateCookieJar`, encrypted and signed, so a
  reader can neither read their own name out of it nor write someone else's in. The key is derived
  from the client secret (`Key::derive_from` over its SHA-512, because it wants 64 bytes), which
  needs no fourth value, is the same on every replica and across a restart, and stops working when
  the secret is rotated. There is no session table: a rolling deployment signs nobody out, and the
  server keeps nothing to lose.
- **The one-time values of a sign-in live in a cookie too.** `rewind_login` carries the CSRF state,
  the nonce, the PKCE verifier and where the person was going, for fifteen minutes. `SameSite=Lax`,
  because the browser comes back from Entra by a top-level navigation and `Lax` allows exactly that.
  `safe_redirect` keeps the "where they were going" to a path on this server, so a link in an email
  cannot walk somebody through a real sign-in and out onto a site of its own.
- **The redirect URI is built, not configured.** From `PUBLIC_URL` when the deployment names it, and
  otherwise from `X-Forwarded-Proto` and `X-Forwarded-Host`. Reading a header is safe in this one
  place: Entra refuses any redirect URI that is not on the app registration, so a forged Host buys
  an error from Entra and nothing else. Nothing else in the file reads them.
- **The discovery document is cached for an hour.** The keys that sign an id_token arrive with it and
  Entra rotates them, so a process that asked once at startup would one day stop being able to read
  one.
- **`email` is not in a v2 id_token** unless the app registration adds it as an optional claim, so
  `preferred_username` — the UPN, always there — stands in for it. This is the one that bites.
- **Authentication, not authorisation.** Anyone in the tenant gets in. Past the door the board
  decides as it always did: the facilitator token, the editor list, the board password. Signing in
  makes nobody the facilitator of anything, and `Identity.sub` is carried for a later change that
  might tie a board to an account.
- **The name is offered, not imposed.** `/api/config` carries the signed-in user, because it is the
  one request of the session either way, and `useSignedInName` fills the name field on the home page
  and the join prompt. Both stay fields — a person may write what the board should call them — and
  an anonymous board still shows no name.
- **A sign-out has to go on to Entra.** Clearing our cookie alone would look like nothing happened:
  the next page asks Entra, Entra still holds the browser's session, and the person is back in
  without a word. The removal uses the plain `CookieJar` and not the private one, because a private
  jar drops a cookie it cannot decrypt as it reads the request and then has nothing to write a
  removal for — a session left over from a rotated secret would otherwise sit there for its full
  twelve hours.
- **A session that runs out mid-meeting is found by the socket.** A refused handshake looks like a
  dropped network to a browser, so `useWebSocket` asks `/api/auth/me` after a socket that never
  opened, and a 401 sends the browser to the door. Only a 401: a 404 means the server asks nobody to
  sign in, and no answer at all means the server is down, and neither is a reason to leave a board.
  `loadConfig` does the same on its one failure, which is what covers `pnpm dev`, where the page
  comes from Vite and the gate never sees the request for it.
- **The desktop app is left out.** It loads its pages from disk and calls the server from another
  origin, so the cookie a sign-in ends with has nowhere to live. `GET /api/health` says whether a
  server asks for an account, and `Setup` and `App` read it to say so plainly and point at the
  browser, rather than letting each request fail on its own.

## Restarting the Service

`POST /api/admin/restart` ends the process with exit code 0, and Kubernetes starts the container
again because the pod carries `restartPolicy: Always`. The code is 0 because the stop is asked
for and is not a fault. The answer goes out before the exit — a handler that exits in place
writes no response, and the admin page would report a network error for a restart that worked.

Nothing on a board is lost: the boards are in PostgreSQL and a browser opens its socket again
after two seconds. What goes is what `AppState` holds in memory — the participant counts and a
pending merge undo. The chart runs one replica; with more, this stops the pod that answers the
request and no other.

## Template Defaults

`templates.default_blurred` says how a board from that template opens. A retro starts blurred,
because the team writes before it reads. A Level 10 meeting works a list the whole room reads
together, so `level10` starts with the cards shown and the facilitator has one less thing to turn
off each week. `create_board` reads the value once, from the template row, and writes it to
`boards.is_blurred`; nothing follows the board after that, and `ToggleBlur` works as it always did.
A custom board, and a board whose template id names no row, starts blurred.

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
template without touching the boards already made from it — "Apply to boards" is what carries a
change across. The columns are Solved, Headlines, Previous Actions, Rocks and IDS; the first of
them read "Segue" until the migration of 2026-08-14, which renamed it in the template row alone,
and Previous Actions moved in after Headlines with the migration of 2026-08-19, which also moves
the column on every board already made from the template. `TEMPLATE_LEVEL10` (`"level10"` in
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
- **Column colors** are hex strings in `COLUMN_COLORS` array (`lib/types.ts`), passed as props to Column/Ticket components and applied via inline `style`. The two role columns take their own colors from `COLUMN_ROLE_COLORS`; `utils/columnColors.ts` runs the sticky colors across the other columns only. The five colors repeat on a long board, which costs nothing: no column is read against another one five places away.
- **A board takes as many columns as the team asks for.** Neither form caps the count and the backend never did; a column keeps its width and the board scrolls sideways past the edge of the window. The spacer at the end of the row in `Board.tsx` is what holds the gutter open at the end of that scroll, which the padding of the page cannot reach.
- **Previous Actions cards** never blur and take no votes. They are a record of the last retro, not fresh input.
- **Comments** live in the card modal, set as notes in the margin: a pen mark in the color of the
  column, the remark, and the writer signed under it. The card on the board carries the count only,
  on the mark in its footer that opens the card. A card that is blurred for you shows no comment
  control, because you cannot read the card yet. Anyone can comment, and the writer, the
  facilitator, or an editor can edit or delete. A merge moves the comments of the source card
  onto the target card, and an undo sends them back.
- **A drag reads by where it ends.** In its own column, a card dropped on another card merges the
  two — two people wrote the same thing — and the undo toast follows. Dropped anywhere in another
  column, the card moves there (`MoveTicket`), a card under the pointer included: a full column
  leaves almost no gap to aim at, so the drop cannot ask the reader to hit one. The column lights
  up while a card from elsewhere is over it, and a card shows the merge ring only for a card of
  its own column. `db::move_ticket` clears the marks the target column cannot hold — a done mark
  outside the two action columns, a rock status outside Rocks — because the server refuses to set
  either one there and the card would otherwise carry a mark nothing can clear.
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
- **The version label** on the home page reads the server, not the bundle. `frontend/package.json`
  stays at 0.0.0, so `GET /api/config` carries `version` from `env!("CARGO_PKG_VERSION")` —
  `backend/Cargo.toml`, which a release bumps with the other three files. `lib/config.ts` holds
  the one config request of the session; the GIPHY key rides on it as well. A server that does
  not answer leaves the label out rather than showing a number it does not have.
