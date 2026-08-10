import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Grid } from "@giphy/react-components";
import { GiphyFetch } from "@giphy/js-fetch-api";
import type { IGif } from "@giphy/js-types";
import { toGif } from "../../lib/giphy";
import type { Gif } from "../../lib/types";

/** How long the pane waits after a keystroke before it asks GIPHY again. */
const SEARCH_DEBOUNCE_MS = 300;

/** How wide the pane wants to be. A board column is narrower, so the pane floats over it. */
const PANE_WIDTH = 340;
const PANE_PADDING = 10;
const GRID_COLUMNS = 3;
const GRID_GUTTER = 6;

/** How tall the sheet of results may grow before it scrolls. */
const SHEET_MAX_HEIGHT = 260;

/** Space kept between the pane and the edge of the window. */
const VIEWPORT_MARGIN = 12;

interface Position {
  left: number;
  top: number;
  width: number;
  /** True when the pane sits above the composer because there was no room below. */
  flipped: boolean;
}

/**
 * Measures where the pane should sit relative to the composer it belongs to.
 *
 * The pane is fixed to the window rather than placed in the column, because a board column
 * clips and scrolls its contents and the pane is wider than the column.
 */
function measure(anchor: HTMLElement | null): Position | null {
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(PANE_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

  // Keep the pane inside the window, and prefer its left edge aligned to the composer.
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
  );

  // The sheet plus its two bars. Enough to decide which side has the room.
  const estimatedHeight = SHEET_MAX_HEIGHT + 64;
  const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const flipped = roomBelow < estimatedHeight && rect.top > roomBelow;

  return {
    left,
    top: flipped ? rect.top : rect.bottom + 6,
    width,
    flipped,
  };
}

interface GifPickerProps {
  /** The key from the server. The SDK client is built here, inside the pane's own chunk. */
  apiKey: string;
  /** What the writer typed after `/gif`. Empty asks GIPHY for what is trending. */
  query: string;
  /** The composer this pane belongs to. The pane hangs off it and closes when it goes away. */
  anchor: HTMLElement | null;
  onPick: (gif: Gif) => void;
  /** Escape: the writer is finished searching, so the command leaves the draft too. */
  onDismiss: () => void;
  /** A click elsewhere: hide the pane, but leave the draft alone. */
  onClose: () => void;
}

/**
 * The GIF pane: a dark sheet of results hung under the composer.
 *
 * It carries no search field of its own. The composer is the search field — the writer types
 * `/gif dancing` and the pane shows what "dancing" finds — so the pane is a window onto the
 * draft rather than a place to start again.
 */
export function GifPicker({
  apiKey,
  query,
  anchor,
  onPick,
  onDismiss,
  onClose,
}: GifPickerProps) {
  const client = useMemo(() => new GiphyFetch(apiKey), [apiKey]);
  const paneRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(() => measure(anchor));
  const [debounced, setDebounced] = useState(query);
  const [failed, setFailed] = useState(false);

  // Hold the query still for a moment, so a word being typed costs one request and not six.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => setFailed(false), [debounced]);

  // Follow the composer: the board scrolls sideways and the columns scroll down.
  useLayoutEffect(() => {
    function reposition() {
      setPosition(measure(anchor));
    }
    reposition();
    window.addEventListener("resize", reposition);
    // Capture, so a scroll on any column reaches this too.
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor]);

  // Escape ends the search and takes the command with it. It is stopped here so that it closes
  // the pane rather than reaching the card behind, which would cancel an edit in progress.
  // A click outside only hides the pane, and never when it lands on the composer, which is the
  // search field and has to stay usable.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    }
    function handlePointer(e: PointerEvent) {
      const target = e.target as Node;
      if (paneRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    }
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, [anchor, onClose, onDismiss]);

  const fetchGifs = useCallback(
    (offset: number) =>
      debounced
        ? client.search(debounced, { offset, limit: 15 })
        : client.trending({ offset, limit: 15 }),
    [client, debounced],
  );

  function handlePick(gif: IGif, e: React.SyntheticEvent<HTMLElement, Event>) {
    e.preventDefault();
    onPick(toGif(gif));
  }

  if (!position) return null;

  const gridWidth = position.width - PANE_PADDING * 2;

  return (
    <div
      ref={paneRef}
      role="dialog"
      aria-label={debounced ? `GIFs for ${debounced}` : "Trending GIFs"}
      className="animate-gif-pane-in fixed z-[60] rounded-xl shadow-2xl ring-1 overflow-hidden"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        // Hung above the composer, the pane grows upward from its own bottom edge.
        transform: position.flipped ? "translateY(-100%) translateY(-6px)" : undefined,
        backgroundColor: "var(--color-darkroom)",
        // @ts-expect-error — Tailwind reads the ring color from this custom property.
        "--tw-ring-color": "var(--color-darkroom-edge)",
      }}
      // The card is a drag handle and the composer must keep the caret. Neither wants these events.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* What the pane is showing, and the way out. */}
      <div
        className="flex items-baseline gap-2 px-3 py-2 border-b"
        style={{ borderColor: "var(--color-darkroom-edge)" }}
      >
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">
          {debounced ? "Searching" : "Trending"}
        </span>
        {debounced && (
          <span className="text-[13px] text-white/90 truncate font-medium">{debounced}</span>
        )}
        <button
          onClick={onDismiss}
          aria-label="Close the GIF pane"
          className="ml-auto shrink-0 text-white/40 hover:text-white/90 transition-colors text-sm leading-none"
        >
          ✕
        </button>
      </div>

      {/* The sheet of results. */}
      <div
        className="overflow-y-auto overscroll-contain"
        style={{ maxHeight: SHEET_MAX_HEIGHT, padding: PANE_PADDING }}
      >
        {failed ? (
          <p className="text-[13px] text-white/70 py-6 text-center">
            GIPHY did not answer. Try again in a moment.
          </p>
        ) : (
          <Grid
            // A new search is a new sheet, so the grid starts over rather than appending.
            key={debounced}
            width={gridWidth}
            columns={GRID_COLUMNS}
            gutter={GRID_GUTTER}
            borderRadius={4}
            fetchGifs={fetchGifs}
            onGifClick={handlePick}
            // Enter or Space places the GIF that has focus, so the pane works from the keyboard.
            onGifKeyPress={(gif, e) => {
              const key = (e as unknown as React.KeyboardEvent).key;
              if (key === "Enter" || key === " ") handlePick(gif, e);
            }}
            onGifsFetchError={() => setFailed(true)}
            tabIndex={0}
            noLink
            hideAttribution
            noResultsMessage={
              <p className="text-[13px] text-white/70 py-6 text-center">
                Nothing for “{debounced}”. Try another word.
              </p>
            }
          />
        )}
      </div>

      {/* GIPHY asks that its name travel with its pictures. */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-t"
        style={{ borderColor: "var(--color-darkroom-edge)" }}
      >
        <span className="text-[10px] text-white/35">Tab to pick, Enter to place</span>
        <a
          href="https://giphy.com"
          target="_blank"
          rel="noreferrer noopener"
          className="text-[10px] tracking-[0.06em] text-white/50 hover:text-white/90 transition-colors"
        >
          Powered by <span className="font-semibold tracking-[0.12em]">GIPHY</span>
        </a>
      </div>
    </div>
  );
}
