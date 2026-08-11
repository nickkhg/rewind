import { fetchConfig } from "./api";
import type { ClientConfig } from "./types";

/**
 * What the server tells the frontend at startup, read once for the whole session.
 *
 * The GIPHY key comes from a Kubernetes secret and the version comes from the build, so neither
 * is in the bundle. One request answers for every caller: the promise is kept and handed to each
 * later one. A server that does not answer gives null, and each reader falls back on its own.
 */
let configPromise: Promise<ClientConfig | null> | null = null;

export function loadConfig(): Promise<ClientConfig | null> {
  if (!configPromise) {
    configPromise = fetchConfig().catch(() => null);
  }
  return configPromise;
}
