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

**Data flow:** Frontend ↔ WebSocket ↔ Axum backend (in-memory state). REST is used only for board creation (`POST /api/boards`). All real-time sync happens via WebSocket at `/ws/boards/{id}`, broadcasting full board state on every mutation. Boards are ephemeral — no database, no persistence.

**Backend state:** `AppState` holds `Arc<RwLock<HashMap<String, Board>>>` for boards and a parallel map of `tokio::sync::broadcast` channels (capacity 64) for WebSocket fan-out. Write lock is held during mutation, released before broadcast.

**Frontend state:** Zustand store (`boardStore.ts`) holds board, participantId, isFacilitator, isConnected, sortMode. The `useWebSocket` hook connects on mount, sends Join with name + optional facilitator token from `sessionStorage`, and dispatches server messages to the store. Auto-reconnects on close (2s delay).

**Auth model:** No accounts. Facilitator gets a `facilitator_token` on board creation, stored in `sessionStorage`. Only the facilitator can toggle blur. Authors can edit/delete their own tickets. Anyone can vote (idempotent toggle via HashSet).

## WebSocket Protocol

Messages are serde-tagged enums: `#[serde(tag = "type", content = "payload")]`. TypeScript mirrors this as discriminated unions in `lib/types.ts`.

Client → Server: `Join`, `AddTicket`, `RemoveTicket`, `EditTicket`, `ToggleVote`, `ToggleBlur`
Server → Client: `BoardState` (after every mutation), `Authenticated` (after Join), `Error`

## Key Conventions

- **Vite proxy:** `/api` and `/ws` routes proxy to `localhost:3001` in dev (`vite.config.ts`), so both web and Tauri use relative URLs. `VITE_API_URL` env var overrides for production.
- **Column colors** are hex strings in `COLUMN_COLORS` array (`lib/types.ts`), passed as props to Column/Ticket components and applied via inline `style`.
- **Card rotation** is seeded from ticket ID hash (deterministic, -1° to 1°).
- **Blur** is CSS `filter: blur(8px)` with 500ms transition. Authors always see their own cards.
- **Sorting** is client-side only (not synced): "newest" or "most-votes" in `utils/sort.ts`.
- **Tailwind v4** with `@theme` block in `global.css` for custom properties. Fonts loaded via Google Fonts `<link>` in `index.html`.
