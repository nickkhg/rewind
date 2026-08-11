import { useRef, useState } from "react";
import { useGifComposer } from "../../hooks/useGifComposer";
import { GifAttachment } from "./GifAttachment";
import type { Gif } from "../../lib/types";

interface TicketEditorProps {
  initialContent: string;
  initialGif: Gif | null;
  /** How tall the field stands. The modal has room for more of the card at once. */
  rows?: number;
  /** The type size of the field, so the words keep the size they had before the edit. */
  textClassName?: string;
  /** How big the GIF is drawn while the card is open for editing. */
  gifSize?: "card" | "modal";
  /** Called with the words and the picture the card should keep. Never called with neither. */
  onSave: (content: string, gif: Gif | null) => void;
  onCancel: () => void;
}

/**
 * The card, open for editing. The same field serves the card on the board and the card in the
 * modal, so a `/gif` search and a keyboard shortcut work the same way in both.
 */
export function TicketEditor({
  initialContent,
  initialGif,
  rows = 2,
  textClassName = "text-sm",
  gifSize = "card",
  onSave,
  onCancel,
}: TicketEditorProps) {
  const [draft, setDraft] = useState(initialContent);
  const [gif, setGif] = useState<Gif | null>(initialGif);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const { picker, hint, text } = useGifComposer({
    value: draft,
    onChange: setDraft,
    gif,
    onGifChange: setGif,
    anchor: fieldRef.current,
    focus: () => fieldRef.current?.focus(),
  });

  function save() {
    // A card has to keep something. Nothing at all leaves it as it was.
    if (!text && !gif) {
      onCancel();
      return;
    }
    onSave(text, gif);
  }

  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={fieldRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        rows={rows}
        className={`w-full rounded border border-border px-2 py-1 resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface ${textClassName}`}
        autoFocus
      />
      {gif && (
        <div className="flex">
          <GifAttachment gif={gif} size={gifSize} onRemove={() => setGif(null)} />
        </div>
      )}
      <div className="flex items-center gap-2 mt-1">
        <button onClick={save} className="text-xs text-accent hover:underline">
          Save
        </button>
        <button onClick={onCancel} className="text-xs text-muted hover:underline">
          Cancel
        </button>
        {hint && <span className="ml-auto">{hint}</span>}
      </div>
      {picker}
    </div>
  );
}
