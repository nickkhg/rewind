import { useRef, useState } from "react";
import { useGifComposer } from "../../hooks/useGifComposer";
import { GifAttachment } from "./GifAttachment";
import type { ClientMessage, Gif } from "../../lib/types";

interface AddTicketFormProps {
  columnId: string;
  send: (msg: ClientMessage) => void;
}

export function AddTicketForm({ columnId, send }: AddTicketFormProps) {
  const [content, setContent] = useState("");
  const [gif, setGif] = useState<Gif | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // `text` is the draft without the `/gif` command, which is what the card should say.
  const { picker, hint, text } = useGifComposer({
    value: content,
    onChange: setContent,
    gif,
    onGifChange: setGif,
    anchor: textareaRef.current,
    focus: () => textareaRef.current?.focus(),
  });

  // A card is either words or a picture. Either one on its own is enough.
  const canSubmit = text.length > 0 || gif !== null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    send({
      type: "AddTicket",
      payload: { column_id: columnId, content: text, gif },
    });
    setContent("");
    setGif(null);
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        placeholder="Add a card..."
        rows={2}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface"
      />

      {gif && (
        <div className="flex">
          <GifAttachment gif={gif} size="card" onRemove={() => setGif(null)} />
        </div>
      )}

      {hint && <div className="mt-1">{hint}</div>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-1.5 w-full text-sm py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40"
      >
        Add
      </button>

      {picker}
    </form>
  );
}
