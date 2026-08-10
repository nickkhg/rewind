import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { parseGifCommand, removeGifCommand } from "../utils/gifCommand";
import type { Gif } from "../lib/types";
import { useGiphyKey } from "./useGiphyKey";

/**
 * The pane carries the GIPHY SDK, which is the largest thing this feature adds. It is fetched
 * the first time somebody types `/gif`, so a retro that uses no GIFs loads none of it.
 */
const GifPicker = lazy(() =>
  import("../components/board/GifPicker").then((m) => ({ default: m.GifPicker })),
);

interface UseGifComposerOptions {
  /** The draft as it stands. The pane reads the search out of it. */
  value: string;
  onChange: (next: string) => void;
  /**
   * The GIF the draft carries. The caller owns it, because a composer that opens and closes per
   * card or per comment has to be able to load it and clear it.
   */
  gif: Gif | null;
  onGifChange: (next: Gif | null) => void;
  /** The element the pane hangs off, which is the composer itself. */
  anchor: HTMLElement | null;
  /** Puts the caret back in the composer after a pick or after the writer uses the hint. */
  focus?: () => void;
}

/**
 * Ties one composer to the GIF pane.
 *
 * The writer types `/gif` and what they want to find; the pane opens and searches as they type;
 * picking a GIF takes the command back out of the draft and hands the picture to the caller. The
 * composer keeps its own text — the GIF travels beside the message, not inside it.
 *
 * Everything here is off when the deployment sets no GIPHY key: no pane, and no hint either.
 */
export function useGifComposer({
  value,
  onChange,
  gif,
  onGifChange,
  anchor,
  focus,
}: UseGifComposerOptions) {
  const apiKey = useGiphyKey();
  const [closed, setClosed] = useState(false);

  const command = parseGifCommand(value);
  const hasCommand = command !== null;

  // A pane the writer closed stays closed until the command goes away. The next `/gif` opens it.
  useEffect(() => {
    if (!hasCommand) setClosed(false);
  }, [hasCommand]);

  const enabled = !!apiKey;
  const open = enabled && hasCommand && !closed;

  /**
   * The draft without the command, which is what the card or the comment should say.
   *
   * `/gif dancing` is an instruction to the pane, never something to post. A writer who types it
   * and then sends anyway — or who gives up on finding a GIF — gets their words and none of the
   * command.
   */
  const text = command ? removeGifCommand(value, command).trim() : value.trim();

  /** Closes the pane and takes the command out of the draft with it. */
  const dismiss = useCallback(() => {
    const current = parseGifCommand(value);
    if (current) onChange(removeGifCommand(value, current));
  }, [onChange, value]);

  const pick = useCallback(
    (picked: Gif) => {
      onGifChange(picked);
      // The words after `/gif` were the search, so they leave with the command.
      const current = parseGifCommand(value);
      onChange(current ? removeGifCommand(value, current) : value);
      focus?.();
    },
    [focus, onChange, onGifChange, value],
  );

  /** Starts the command for a writer who would rather not type it. */
  const insertCommand = useCallback(() => {
    const needsSpace = value.length > 0 && !/\s$/.test(value);
    onChange(`${value}${needsSpace ? " " : ""}/gif `);
    focus?.();
  }, [focus, onChange, value]);

  const picker =
    open && apiKey && command ? (
      // No fallback: until the pane's code arrives there is nothing to show, and a flash of
      // placeholder under the composer would read as a fault.
      <Suspense fallback={null}>
        <GifPicker
          apiKey={apiKey}
          query={command.query}
          anchor={anchor}
          onPick={pick}
          // Escape means "I am done searching", so the command goes. A click elsewhere is a
          // weaker signal, so that one only hides the pane and leaves the draft as it was.
          onDismiss={dismiss}
          onClose={() => setClosed(true)}
        />
      </Suspense>
    ) : null;

  /**
   * The quiet note under a composer that says the command is there. It is the only clue a first
   * time writer gets, so it doubles as the button.
   */
  const hint =
    enabled && !gif && !hasCommand ? (
      <button
        type="button"
        onClick={insertCommand}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-[10px] text-muted hover:text-accent transition-colors"
        title="Search GIPHY for a GIF"
      >
        <span className="font-medium">/gif</span> to add a GIF
      </button>
    ) : null;

  return { picker, hint, text, gifEnabled: enabled };
}
