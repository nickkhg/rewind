import { fetchConfig } from "./api";
import { redirectIfSignedOut } from "./auth";
import type { ClientConfig } from "./types";

/**
 * What the server tells the frontend at startup, read once for the whole session.
 *
 * The GIPHY key comes from a Kubernetes secret and the version comes from the build, so neither
 * is in the bundle. One request answers for every caller: the promise is kept and handed to each
 * later one. A server that does not answer gives null, and each reader falls back on its own.
 *
 * A refusal is the one failure worth acting on. In the built app the page itself comes from the
 * server, so a browser with no session is sent to Entra before any of this code runs — but under
 * `pnpm dev` the page comes from Vite, which asks nobody for anything, and a session can run out
 * while a tab sits open. Either way this is the first request of the session, so it is the right
 * place to find out and go to the door.
 */
let configPromise: Promise<ClientConfig | null> | null = null;

export function loadConfig(): Promise<ClientConfig | null> {
  if (!configPromise) {
    configPromise = fetchConfig().catch(() => {
      redirectIfSignedOut();
      return null;
    });
  }
  return configPromise;
}
