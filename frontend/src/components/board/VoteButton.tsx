import { useState } from "react";
import type { ClientMessage } from "../../lib/types";

interface VoteButtonProps {
  ticketId: string;
  voteCount: number;
  hasVoted: boolean;
  send: (msg: ClientMessage) => void;
}

export function VoteButton({ ticketId, voteCount, hasVoted, send }: VoteButtonProps) {
  const [bouncing, setBouncing] = useState(false);

  function handleClick() {
    send({ type: "ToggleVote", payload: { ticket_id: ticketId } });
    setBouncing(true);
    setTimeout(() => setBouncing(false), 300);
  }

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
        hasVoted
          ? "bg-accent text-white"
          : "bg-canvas text-muted hover:text-ink"
      } ${bouncing ? "animate-vote-bounce" : ""}`}
    >
      <span className="leading-none">&#9650;</span>
      <span>{voteCount}</span>
    </button>
  );
}
