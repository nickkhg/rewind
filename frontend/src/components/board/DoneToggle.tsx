import { formatRelativeDate } from "../../utils/date";
import type { ClientMessage } from "../../lib/types";

/** The tick itself. One stroke, drawn the way a pen closes a line on a list. */
function Check({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 14 14"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7.4 5.8 10.2 11 4.6" />
    </svg>
  );
}

interface DoneToggleProps {
  ticketId: string;
  /** When the action was closed, or null while it is still open. */
  doneAt: string | null;
  /** The author, the facilitator and the editors close an action. Everyone else only reads it. */
  canSet: boolean;
  /** `mark` is the disc in the corner of a card. `labelled` carries the words as well. */
  variant?: "mark" | "labelled";
  /** True on a card, where an open action shows its circle only under the pointer. */
  quiet?: boolean;
  send: (msg: ClientMessage) => void;
}

/**
 * Closes an action, or opens it again.
 *
 * An action that is finished used to be deleted, and the record went with it. The tick keeps the
 * card: the next retro reads what the team said it would do and what it did. An open action
 * offers a hairline circle; a closed one is filled, and the card behind it goes quiet.
 */
export function DoneToggle({
  ticketId,
  doneAt,
  canSet,
  variant = "mark",
  quiet,
  send,
}: DoneToggleProps) {
  const done = doneAt !== null;

  // An open action says nothing to a reader who cannot close it, rather than showing a control
  // that does not work.
  if (!canSet && !done) return null;

  const label = done ? "Done" : "Mark done";
  const title = done ? "Reopen the action" : "Mark the action done";

  function toggle() {
    send({ type: "SetTicketDone", payload: { ticket_id: ticketId, done: !done } });
  }

  const disc = (
    <span
      className={`flex items-center justify-center w-5 h-5 rounded-full shrink-0 transition-colors ${
        done
          ? "bg-[#5f9e6e] text-white"
          : "border border-border text-transparent group-hover/done:border-[#5f9e6e]/70 group-hover/done:text-[#5f9e6e] group-hover/done:bg-[#5f9e6e]/10"
      }`}
    >
      <Check className="w-3 h-3" />
    </span>
  );

  if (variant === "labelled") {
    if (!canSet) {
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[#4e8a5c]">
          {disc}
          <span>
            Done
            {doneAt && <span className="text-muted font-normal"> · {formatRelativeDate(doneAt)}</span>}
          </span>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={toggle}
        onPointerDown={(e) => e.stopPropagation()}
        aria-pressed={done}
        title={title}
        className={`group/done inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full text-xs font-medium transition-colors ${
          done
            ? "bg-[#5f9e6e]/10 text-[#4e8a5c] ring-1 ring-[#5f9e6e]/30 hover:bg-[#5f9e6e]/[0.16]"
            : "text-muted hover:text-ink ring-1 ring-border hover:ring-[#5f9e6e]/50"
        }`}
      >
        {disc}
        <span>
          {label}
          {done && doneAt && (
            <span className="text-muted font-normal"> · {formatRelativeDate(doneAt)}</span>
          )}
        </span>
      </button>
    );
  }

  if (!canSet) {
    return (
      <span className="group/done inline-flex" title={`Done ${doneAt ? formatRelativeDate(doneAt) : ""}`}>
        {disc}
        <span className="sr-only">Done</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // The whole card is a drag handle. Closing an action must not move the card.
      onPointerDown={(e) => e.stopPropagation()}
      aria-pressed={done}
      aria-label={title}
      title={title}
      className={`group/done inline-flex rounded-full transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        // An open action keeps its circle out of the way until a hand comes near the card.
        quiet && !done ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100" : ""
      }`}
    >
      {disc}
    </button>
  );
}
