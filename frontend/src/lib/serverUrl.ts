const STORAGE_KEY = "rewind_server_url";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function getServerUrl(): string {
  if (!isTauri()) {
    return import.meta.env.VITE_API_URL ?? "";
  }
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, url);
}

export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasServerUrl(): boolean {
  return !isTauri() || !!localStorage.getItem(STORAGE_KEY);
}
