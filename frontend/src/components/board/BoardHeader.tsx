import { useState } from "react";
import { Logo } from "../layout/Logo";
import { SignedInAs } from "../layout/SignedInAs";
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
          {/* The room can see that the link alone does not open this board. */}
          {board.has_password && (
            <span
              className="shrink-0 text-muted"
              title="This board asks for a password"
              aria-label="This board asks for a password"
              role="img"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
          )}
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
          {/* Who you signed in as, on a deployment that asks. Nothing on one that does not. */}
          <SignedInAs className="hidden md:flex max-w-[14rem]" />
        </div>
      </div>
    </header>
  );
}
