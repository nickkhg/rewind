# Rewind

A real-time retrospective tool for teams. Run column-based retro sessions where everyone collaborates live — as a website or macOS desktop app.

No accounts needed. The facilitator creates a board, shares a link, and the team adds cards, votes, and reveals together. Boards are persisted in PostgreSQL so they survive server restarts.

<p align="center">
  <img src="docs/screenshots/board.png" alt="Board view — light mode" width="720" />
</p>

<details>
<summary>Dark mode</summary>
<p align="center">
  <img src="docs/screenshots/board-dark.png" alt="Board view — dark mode" width="720" />
</p>
</details>

## Features

- **Real-time collaboration** — cards, votes, and blur state sync instantly via WebSocket
- **Blur / Reveal** — facilitator controls card visibility; authors always see their own cards
- **Voting** — toggle votes on any card, sort by most votes or newest
- **Board templates** — Classic, Start/Stop/Continue, 4Ls, Mad Sad Glad, Sailboat, DAKI — managed in the database
- **Custom columns** — or define your own column layout
- **Anonymous boards** — optional name-free mode (enabled by default)
- **Share link** — one-click copy to clipboard
- **Dark mode** — light and dark themes with system preference detection
- **Desktop app** — native macOS window via Tauri v2 with `rewind://` deep links
- **Admin CMS** — view all boards and manage templates (see below)

<p align="center">
  <img src="docs/screenshots/home.png" alt="Home page — create a board" width="560" />
</p>

<details>
<summary>Home page — dark mode</summary>
<p align="center">
  <img src="docs/screenshots/home-dark.png" alt="Home page — dark mode" width="560" />
</p>
</details>

## Architecture

```
frontend/     React + Vite + Tailwind v4 + Zustand
backend/      Rust Axum server (REST + WebSocket) + PostgreSQL
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

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string (e.g. `postgres://user:pass@localhost:5432/rewind`) |
| `PORT` | No | `3001` | Port the backend listens on |
| `STATIC_DIR` | No | — | Path to built frontend assets. When set, the backend serves them and handles SPA routing |
| `ADMIN_TOKEN_HASH` | No | — | Argon2id hash for admin access (see [Admin Interface](#admin-interface)). If omitted, admin routes return 404 |
| `VITE_API_URL` | No | — | Frontend override for backend URL (only needed if the frontend is hosted separately from the backend) |
| `RUST_LOG` | No | `info` | Log level filter (e.g. `debug`, `rewind_backend=debug`) |

### Production Build

```bash
cd frontend && pnpm build
cd ../backend && cargo build --release
cargo tauri build  # for macOS .app bundle
```

## Deployment

### Option 1: Docker Compose (recommended)

The simplest way to run Rewind. This starts PostgreSQL and the app together:

```bash
docker compose up -d
```

The app is available at `http://localhost:3001`. The Compose file includes a health check on the database — the app waits for it before starting.

To customize, copy the environment block from `docker-compose.yml` or use an `.env` file:

```env
DATABASE_URL=postgres://rewind:rewind@db:5432/rewind
ADMIN_TOKEN_HASH=$argon2id$v=19$m=19456,t=2,p=1$SALT$HASH
```

> **Note:** If setting `ADMIN_TOKEN_HASH` directly in `docker-compose.yml`, double all `$` signs to escape YAML variable interpolation (e.g. `$$argon2id$$v=19$$...`). Using an `env_file:` avoids this.

### Option 2: Docker image only

Pull the pre-built image from GitHub Container Registry (published on each tagged release):

```bash
docker pull ghcr.io/nickkhg/rewind:latest
```

Run it against your own PostgreSQL instance:

```bash
docker run -d -p 3001:3001 \
  -e DATABASE_URL=postgres://user:pass@host:5432/rewind \
  -e ADMIN_TOKEN_HASH='$argon2id$...' \
  ghcr.io/nickkhg/rewind:latest
```

The image bundles both the backend binary and the frontend static assets — no separate web server needed.

### Option 3: Standalone binary + static files

Each GitHub release includes:

- **`rewind-backend`** — statically-linked Linux binary (x86_64 musl)
- **`frontend-dist.tar.gz`** — pre-built frontend assets

Deploy them together:

```bash
# Extract frontend assets
mkdir -p /srv/rewind/static
tar -xzf frontend-dist.tar.gz -C /srv/rewind/static

# Run the server
DATABASE_URL=postgres://user:pass@localhost:5432/rewind \
STATIC_DIR=/srv/rewind/static \
PORT=3001 \
./rewind-backend
```

The backend serves the frontend at the same port and handles SPA fallback routing — no Nginx or reverse proxy required for basic setups.

### Option 4: Backend only (API server)

If you host the frontend separately (e.g. on a CDN or different server), run the backend without `STATIC_DIR`:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/rewind \
PORT=3001 \
./rewind-backend
```

Then build and deploy the frontend pointing at the backend:

```bash
cd frontend
VITE_API_URL=https://api.example.com pnpm build
```

The resulting `dist/` directory can be served by any static file host. WebSocket connections go to the same `VITE_API_URL` origin.

### Database

Rewind requires PostgreSQL (tested with 15–17). Migrations run automatically on startup — no manual schema setup needed. The backend creates all tables, indexes, and seed data (default templates) on first launch.

### CI/CD

The GitHub Actions workflow (`.github/workflows/release.yml`) builds all artifacts on a tagged push (`v*`):

| Artifact | Description |
|----------|-------------|
| macOS DMG | Signed & notarized Tauri desktop app |
| Linux binary | Static musl binary for `x86_64` |
| Frontend tarball | Pre-built Vite output |
| Docker image | Multi-stage image pushed to `ghcr.io` |

To create a release: `git tag v1.1.0 && git push --tags`

## Admin Interface

An optional admin dashboard at `/admin` lets a privileged user view all boards, manage templates, and delete boards. Access is gated by an Argon2-hashed secret token.

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
5. Switch to the **Templates** tab to create, edit, or delete board templates
6. Delete boards from the table or detail panel (with confirmation dialog)

### API Endpoints

All admin endpoints require `Authorization: Bearer <plaintext-token>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/verify` | Verify token (200 or 401) |
| `GET` | `/api/admin/stats` | Global counts (boards, tickets, votes, online) |
| `GET` | `/api/admin/boards` | List all boards with stats |
| `GET` | `/api/admin/boards/:id` | Board detail (columns, facilitator token) |
| `DELETE` | `/api/admin/boards/:id` | Delete board (cascades tickets/votes) |
| `GET` | `/api/admin/templates` | List all templates |
| `POST` | `/api/admin/templates` | Create a template |
| `PUT` | `/api/admin/templates/:id` | Update a template |
| `DELETE` | `/api/admin/templates/:id` | Delete a template |

## Design

"Warm Workshop" aesthetic — sticky notes on a real whiteboard.

- **Fonts**: Fraunces (display) + Plus Jakarta Sans (body)
- **Palette**: warm canvas `#faf8f5`, terracotta accent `#e07a5f`, column colors (green, rose, amber, blue, purple)
- **Details**: colored left borders, seeded card rotation, blur reveal transition, vote bounce animation, subtle noise texture
