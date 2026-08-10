import { useState } from "react";
import type { Gif } from "../../lib/types";

/** How tall a GIF may stand. A card gets more room than a comment. */
const MAX_HEIGHT = { card: 170, comment: 120 } as const;

/** How wide a GIF may spread inside a board column. */
const MAX_WIDTH = 220;

/**
 * A hidden GIF needs a heavier hand than hidden words.
 * Blurred text is unreadable at once, but a picture keeps its shape and its colours, and a
 * well known GIF is recognisable from those alone. Draining the colour takes that away too.
 */
const HIDDEN_FILTER = "blur(16px) saturate(0.35)";

/**
 * The angle a GIF is laid at, taken from its id so that it never moves between renders.
 * Small: the picture reads as pasted onto the card, not as part of the layout.
 */
function pasteAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ((Math.abs(hash) % 25) - 12) / 10;
}

interface GifAttachmentProps {
  gif: Gif;
  size: keyof typeof MAX_HEIGHT;
  /** True while the card is hidden from this reader. The picture holds the punchline too. */
  blurred?: boolean;
  /** Given in a composer, where the writer can still take the GIF back off. */
  onRemove?: () => void;
}

/**
 * A GIF on a card, mounted the way a photograph is: a paper border with a deeper foot, laid at a
 * slight angle. It rests on its still frame and moves when the reader hovers or focuses it, so a
 * full board does not move all at once.
 */
export function GifAttachment({ gif, size, blurred, onRemove }: GifAttachmentProps) {
  const [playing, setPlaying] = useState(false);

  // The stored size holds the space, so the card does not jump when the picture lands. The
  // natural width is a ceiling as well: a GIF drawn wider than its own frame only looks soft.
  const ratio = gif.width > 0 && gif.height > 0 ? gif.height / gif.width : 0.75;
  const maxHeight = MAX_HEIGHT[size];
  const width = Math.min(gif.width, MAX_WIDTH, Math.round(maxHeight / ratio));

  // A picture nobody may read yet must not move, or the motion gives it away.
  const showMotion = playing && !blurred;

  return (
    <figure
      className="animate-gif-place mt-2 mb-0.5 inline-block"
      style={{ transform: `rotate(${pasteAngle(gif.id)}deg)` }}
    >
      <div
        className="relative bg-white pt-1.5 px-1.5 pb-4 rounded-[3px] ring-1 ring-black/10 shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
        style={{ width: width + 12 }}
        onPointerEnter={() => setPlaying(true)}
        onPointerLeave={() => setPlaying(false)}
      >
        <img
          src={showMotion ? gif.url : gif.still_url}
          alt={blurred ? "A hidden GIF" : gif.title}
          width={gif.width}
          height={gif.height}
          loading="lazy"
          tabIndex={0}
          onFocus={() => setPlaying(true)}
          onBlur={() => setPlaying(false)}
          className="block w-full h-auto rounded-[2px] bg-black/5 transition-[filter] duration-500 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{
            maxHeight,
            filter: blurred ? HIDDEN_FILTER : "none",
            ...(blurred ? { userSelect: "none" as const } : {}),
          }}
        />

        {/*
          The caption line of the mount. GIPHY asks that its name travel with its pictures, so the
          credit is the one thing the foot always carries. The GIPHY title is not repeated here:
          it is often a long description that truncates to nothing useful, and the alt text on the
          picture already carries it for anyone who cannot see the picture.
        */}
        <figcaption className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 pb-1 pt-0.5">
          {blurred && (
            <span className="text-[8px] uppercase tracking-[0.14em] text-black/50">Hidden</span>
          )}
          <span className="ml-auto shrink-0 text-[8px] text-black/40">
            Powered by <span className="font-semibold tracking-[0.06em]">GIPHY</span>
          </span>
        </figcaption>

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove GIF"
            title="Remove GIF"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-white text-[11px] leading-none flex items-center justify-center shadow ring-2 ring-surface hover:bg-red-500 transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </figure>
  );
}
