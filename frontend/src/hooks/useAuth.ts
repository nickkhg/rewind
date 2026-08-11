import { useEffect, useState } from "react";
import { loadConfig } from "../lib/config";
import type { AuthConfig } from "../lib/types";

/** What a server that asks nobody to sign in looks like, and what a server that will not answer does. */
const OPEN: AuthConfig = { enabled: false, user: null };

/**
 * Whether this server asks for a work account, and who the reader signed in as.
 *
 * `undefined` while the one config call of the session is out, so a control that depends on the
 * answer can wait rather than appear and then go away again. A server that does not answer reads as
 * open, which is what a plain `cargo run` is.
 */
export function useAuth(): AuthConfig | undefined {
  const [auth, setAuth] = useState<AuthConfig | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadConfig().then((config) => {
      if (live) setAuth(config?.auth ?? OPEN);
    });
    return () => {
      live = false;
    };
  }, []);

  return auth;
}

/**
 * The name Entra holds for this reader, or null.
 *
 * It fills a name field rather than replacing it: a person may still write what the board should
 * call them, and an anonymous board shows no name at all.
 */
export function useSignedInName(): string | null {
  return useAuth()?.user?.name ?? null;
}
