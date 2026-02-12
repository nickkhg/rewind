# Rewind

A real-time retrospective tool for teams. Run column-based retro sessions where everyone collaborates live — as a website or macOS desktop app.

Boards are ephemeral: no accounts, no persistence. The facilitator creates a board, shares a link, and the team adds cards, votes, and reveals together.

## Architecture

```
frontend/     React + Vite + Tailwind v4 + Zustand
backend/      Rust Axum server (REST + WebSocket)
src-tauri/    Tauri v2 desktop wrapper
```

- REST for board creation, WebSocket for everything else
- Full board state broadcast on every mutation (no diffs — boards are small)
- `tokio::sync::broadcast` per board for WebSocket fan-out
- Vite proxy in dev so both web and Tauri use relative URLs

## Getting Started

### Prerequisites

- Rust (stable)
- Node.js 18+
- pnpm

### Development

```bash
# Install frontend dependencies
cd frontend && pnpm install && cd ..

# Terminal 1: Backend (port 3001)
cd backend && cargo run

# Terminal 2: Frontend (port 5173)
cd frontend && pnpm dev
```

Open http://localhost:5173 to use the app.

### Desktop App

```bash
cargo tauri dev
```

### Production Build

```bash
cd frontend && pnpm build
cd ../backend && cargo build --release
cargo tauri build  # for macOS .app bundle
```

## Features

- **Real-time collaboration** — cards, votes, and blur state sync instantly via WebSocket
- **Blur/Reveal** — facilitator controls card visibility; authors always see their own cards
- **Voting** — toggle votes on any card, sort by most votes or newest
- **Editable columns** — customize column names when creating a board (defaults: Went Well, To Improve, Action Items)
- **Share link** — one-click copy to clipboard
- **Desktop app** — native macOS window via Tauri v2 with `rewind://` deep links

## Design

"Warm Workshop" aesthetic — sticky notes on a real whiteboard.

- **Fonts**: Fraunces (display) + Plus Jakarta Sans (body)
- **Palette**: warm canvas `#faf8f5`, terracotta accent `#e07a5f`, column colors (green, rose, amber, blue, purple)
- **Details**: colored left borders, seeded card rotation, blur reveal transition, vote bounce animation, subtle noise texture
