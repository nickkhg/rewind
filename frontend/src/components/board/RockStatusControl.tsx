import type { ClientMessage, RockStatus } from "../../lib/types";

/** The two marks a rock can carry, in the order the pair shows them. */
const MARKS = ["on_track", "off_track"] as const;

const LABELS: Record<RockStatus, string> = {
  on_track: "On track",
  off_track: "Off track",
};

/**
 * The tint of each mark. The scorecard uses the same two tints for its lines, so a reader
 * learns the vocabulary once and reads it everywhere on a Level 10 board.
 */
const TONES: Record<RockStatus, { chip: string; dot: string; text: string }> = {
  on_track: {
    chip: "bg-green-500/10 text-green-600 ring-1 ring-green-500/30",
    dot: "bg-green-500",
    text: "text-green-600",
  },
  off_track: {
    chip: "bg-red-500/10 text-red-600 ring-1 ring-red-500/30",
    dot: "bg-red-500",
    text: "text-red-600",
  },
};

interface RockStatusControlProps {
  ticketId: string;
  status: RockStatus | null;
  /** The author, the facilitator and the editors set the mark. Everyone else only reads it. */
  canSet: boolean;
  send: (msg: ClientMessage) => void;
}

/**
 * Where one rock stands, at the foot of its card. A reader gets a dot and a word; the people
 * who own the rock get the pair of pills, and the pill that is already on takes the mark off.
 */
export function RockStatusControl({ ticketId, status, canSet, send }: RockStatusControlProps) {
  if (!canSet) {
    // An unmarked rock says nothing rather than showing an empty control to a reader.
    if (!status) return null;
    const tone = TONES[status];
    return (
      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${tone.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden />
        {LABELS[status]}
      </span>
    );
  }

  function handleSet(mark: RockStatus) {
    send({
      type: "SetRockStatus",
      payload: { ticket_id: ticketId, status: status === mark ? null : mark },
    });
  }

  return (
    <div
      role="group"
      aria-label="Rock status"
      className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-canvas p-0.5"
      // The whole card is a drag handle. Setting the mark must not move the card.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {MARKS.map((mark) => {
        const active = status === mark;
        return (
          <button
            key={mark}
            onClick={() => handleSet(mark)}
            aria-pressed={active}
            title={active ? "Clear the mark" : LABELS[mark]}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
              active ? TONES[mark].chip : "text-muted hover:text-ink"
            }`}
          >
            {LABELS[mark]}
          </button>
        );
      })}
    </div>
  );
}
