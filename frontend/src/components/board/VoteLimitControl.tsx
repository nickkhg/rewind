import { useState, useEffect, useRef } from "react";
import { useBoardStore } from "../../store/boardStore";
import type { ClientMessage } from "../../lib/types";

interface VoteLimitControlProps {
  send: (msg: ClientMessage) => void;
}

export function VoteLimitControl({ send }: VoteLimitControlProps) {
  const boardLimit = useBoardStore((s) => s.board?.vote_limit_per_column ?? null);
  const [localLimit, setLocalLimit] = useState<number | null>(boardLimit);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalLimit(boardLimit);
  }, [boardLimit]);

  function sendLimit(limit: number | null) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      send({ type: "SetVoteLimit", payload: { limit } });
    }, 250);
  }

  function handleMinus() {
    if (localLimit === null || localLimit <= 1) {
      return;
    }
    const next = localLimit - 1;
    setLocalLimit(next);
    sendLimit(next);
  }

  function handlePlus() {
    if (localLimit === null) {
      const next = 1;
      setLocalLimit(next);
      sendLimit(next);
    } else if (localLimit < 10) {
      const next = localLimit + 1;
      setLocalLimit(next);
      sendLimit(next);
    }
  }

  function handleToggle() {
    if (localLimit === null) {
      setLocalLimit(3);
      sendLimit(3);
    } else {
      setLocalLimit(null);
      sendLimit(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Vote Limit per Column</span>
        <button
          onClick={handleToggle}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            localLimit !== null ? "bg-accent" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              localLimit !== null ? "translate-x-4" : ""
            }`}
          />
        </button>
      </div>
      {localLimit !== null && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleMinus}
            disabled={localLimit <= 1}
            className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-sm hover:bg-canvas disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            -
          </button>
          <span className="text-sm font-semibold tabular-nums w-6 text-center">
            {localLimit}
          </span>
          <button
            onClick={handlePlus}
            disabled={localLimit >= 10}
            className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-sm hover:bg-canvas disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            +
          </button>
          <span className="text-xs text-muted">votes per person</span>
        </div>
      )}
    </div>
  );
}
