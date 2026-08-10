import { useState } from "react";
import { Logo } from "../layout/Logo";
import { useBoardStore } from "../../store/boardStore";
import { FacilitatorMenu } from "./FacilitatorMenu";
import { TimerDisplay } from "./TimerDisplay";
import { SortControls } from "./SortControls";
import { EditorRequestButton } from "./EditorRequestButton";
import { MeetingRating } from "./MeetingRating";
import { isLevel10 } from "../../lib/types";
import type { ClientMessage } from "../../lib/types";

interface BoardHeaderProps {
  send: (msg: ClientMessage) => void;
}

export function BoardHeader({ send }: BoardHeaderProps) {
  const { board, isFacilitator, isConnected, participantId } = useBoardStore();
  const [copied, setCopied] = useState(false);
  const isEditor = !!(board && participantId && board.editors.some((e) => e.participant_id === participantId));

  if (!board) return null;

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo className="text-xl text-accent shrink-0" />
          <h1 className="font-display text-lg font-semibold truncate">{board.title}</h1>
          {board.labels.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              {board.labels.map((label) => (
                <span
                  key={label}
                  className="text-[11px] px-1.5 py-0.5 rounded-md border border-border text-muted"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          <span className="text-xs text-muted shrink-0">
            {board.participant_count} {board.participant_count === 1 ? "person" : "people"}
          </span>
          {!isConnected && (
            <span className="text-xs text-red-500 shrink-0">Reconnecting...</span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <SortControls />
          <TimerDisplay />
          {/* A Level 10 meeting closes on a mark out of ten. */}
          {isLevel10(board) && <MeetingRating send={send} />}
          {!isFacilitator && !isEditor && <EditorRequestButton send={send} />}
          {(isFacilitator || isEditor) && <FacilitatorMenu send={send} />}
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-canvas transition-colors"
          >
            {copied ? "Copied!" : "Share Link"}
          </button>
        </div>
      </div>
    </header>
  );
}
