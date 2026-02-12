import { useState } from "react";
import type { ClientMessage } from "../../lib/types";

interface AddTicketFormProps {
  columnId: string;
  send: (msg: ClientMessage) => void;
}

export function AddTicketForm({ columnId, send }: AddTicketFormProps) {
  const [content, setContent] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    send({ type: "AddTicket", payload: { column_id: columnId, content: trimmed } });
    setContent("");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <textarea
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
      <button
        type="submit"
        className="mt-1.5 w-full text-sm py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
      >
        Add
      </button>
    </form>
  );
}
