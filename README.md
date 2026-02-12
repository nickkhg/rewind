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
- PostgreSQL (or Docker)

### Development

```bash
# Start PostgreSQL (if using Docker)
docker compose up db -d

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
- **Admin interface** — view all boards, stats, and delete boards (see below)

## Admin Interface

An optional admin dashboard at `/admin` lets a privileged user view all boards in the database and delete them. Access is gated by an Argon2-hashed secret token.

### Setup

#### 1. Generate a token hash

```bash
cd backend && cargo run --bin hash_admin_token
```

Enter a plaintext token when prompted. The tool outputs an Argon2id PHC string like:

```
ADMIN_TOKEN_HASH=$argon2id$v=19$m=19456,t=2,p=1$SALT$HASH
```

#### 2. Configure the backend

Add the hash to `backend/.env`:

```env
ADMIN_TOKEN_HASH=$argon2id$v=19$m=19456,t=2,p=1$SALT$HASH
```

The env var is optional — if omitted, the admin routes return 404.

When the backend starts with a valid hash, it logs:

```
INFO  admin interface enabled
```

#### 3. Docker Compose

In `docker-compose.yml`, `$` signs must be doubled to escape YAML variable interpolation:

```yaml
environment:
  ADMIN_TOKEN_HASH: $$argon2id$$v=19$$m=19456,t=2,p=1$$SALT$$HASH
```

Alternatively, use an `env_file:` — `.env` files don't need escaping.

### Usage

1. Visit the home page and click the **Admin** link below the form
2. Enter the plaintext admin token to log in (stored in `sessionStorage`)
3. The dashboard shows global stats (boards, tickets, votes, online users) and a board table
4. Click a board row to see its detail panel (columns, facilitator token, blur state)
5. Delete boards from the table or detail panel (with confirmation dialog)

### API Endpoints

All admin endpoints require `Authorization: Bearer <plaintext-token>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/verify` | Verify token (200 or 401) |
| `GET` | `/api/admin/stats` | Global counts (boards, tickets, votes, online) |
| `GET` | `/api/admin/boards` | List all boards with stats |
| `GET` | `/api/admin/boards/:id` | Board detail (columns, facilitator token) |
| `DELETE` | `/api/admin/boards/:id` | Delete board (cascades tickets/votes) |

## Design

"Warm Workshop" aesthetic — sticky notes on a real whiteboard.

- **Fonts**: Fraunces (display) + Plus Jakarta Sans (body)
- **Palette**: warm canvas `#faf8f5`, terracotta accent `#e07a5f`, column colors (green, rose, amber, blue, purple)
- **Details**: colored left borders, seeded card rotation, blur reveal transition, vote bounce animation, subtle noise texture
