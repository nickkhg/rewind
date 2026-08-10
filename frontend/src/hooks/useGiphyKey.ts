import { useEffect, useState } from "react";
import { loadGiphyKey } from "../lib/giphy";

/**
 * The GIPHY key, or null when the deployment sets none.
 *
 * `undefined` while the first call is out. A composer waits for a settled answer before it offers
 * the GIF control, so the control never appears and then disappears again.
 */
export function useGiphyKey(): string | null | undefined {
  const [key, setKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadGiphyKey().then((k) => {
      if (live) setKey(k);
    });
    return () => {
      live = false;
    };
  }, []);

  return key;
}
