import { useEffect, useState } from "react";
import { loadConfig } from "../lib/config";

/**
 * The version of the server the app talks to.
 *
 * The web app has no version of its own — `frontend/package.json` stays at 0.0.0 — so the label
 * reads the one the server was built with. Null while the call is out, and null again when the
 * server does not answer, so the label stays away rather than showing a number it does not have.
 */
export function useServerVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadConfig().then((config) => {
      if (live) setVersion(config?.version ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  return version;
}
