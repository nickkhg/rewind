import { useEffect, useState } from "react";
import { loadConfig } from "../lib/config";

/**
 * Whether this server can suggest which cards to merge. False until the config answers, and on a
 * deployment that names no Foundry deployment, so the control never shows and then goes away.
 */
export function useAiGrouping(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let live = true;
    loadConfig().then((config) => {
      if (live) setEnabled(config?.ai_grouping ?? false);
    });
    return () => {
      live = false;
    };
  }, []);

  return enabled;
}
