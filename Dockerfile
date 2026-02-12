# --- Frontend build ---
FROM node:22-alpine AS frontend
RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY frontend/ frontend/
RUN pnpm --filter frontend build

# --- Backend build ---
FROM rust:alpine AS backend
RUN apk add --no-cache musl-dev
WORKDIR /app

# Build only the backend (skip src-tauri which needs GUI libs)
COPY backend/ backend/
WORKDIR /app/backend
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/backend/target \
    cargo build --release && cp target/release/rewind-backend /rewind-backend

# --- Runtime ---
FROM alpine:3.21
RUN adduser -D rewind

COPY --from=backend /rewind-backend /usr/local/bin/rewind
COPY --from=frontend /app/frontend/dist /srv/static

USER rewind
ENV STATIC_DIR=/srv/static PORT=3001
EXPOSE 3001

CMD ["rewind"]
