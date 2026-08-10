import type { IGif } from "@giphy/js-types";
import { fetchConfig } from "./api";
import type { Gif } from "./types";

/**
 * The GIPHY key, read once for the whole session.
 *
 * It comes from the server, which reads it out of a Kubernetes secret, so the frontend cannot
 * know at build time whether GIFs are on at all. One request answers for every composer on the
 * board: the promise is kept and handed to each later caller.
 *
 * Nothing from the GIPHY SDK is imported here. The SDK lives in the pane, which loads only when
 * a writer asks for it, so a board that never uses a GIF never pays for the code.
 */
let keyPromise: Promise<string | null> | null = null;

export function loadGiphyKey(): Promise<string | null> {
  if (!keyPromise) {
    keyPromise = fetchConfig()
      .then((config) => config.giphy_api_key ?? null)
      .catch(() => null);
  }
  return keyPromise;
}

/** The width of the rendition the board keeps. It suits a card in a column. */
const RENDITION_WIDTH = 200;

/**
 * Takes what the board needs out of a GIPHY result.
 *
 * The board keeps its own record rather than the whole GIPHY object, so that a card draws from
 * six plain values and never calls GIPHY again to show a picture it already has.
 */
export function toGif(gif: IGif): Gif {
  const animated = gif.images.fixed_width;
  const still = gif.images.fixed_width_still;
  return {
    id: String(gif.id),
    url: animated.url,
    still_url: still.url,
    width: Number(animated.width) || RENDITION_WIDTH,
    height: Number(animated.height) || RENDITION_WIDTH,
    title: gif.title?.trim() || "GIF",
  };
}
