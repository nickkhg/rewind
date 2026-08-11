import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBoardStore } from "../../store/boardStore";
import { VoteLimitControl } from "./VoteLimitControl";
import { TimerControl } from "./TimerControl";
import { BoardLabelsControl } from "./BoardLabelsControl";
import { CarryActionsPanel } from "./CarryActionsPanel";
import { BoardPasswordControl } from "./BoardPasswordControl";
import type { ClientMessage } from "../../lib/types";

interface FacilitatorMenuProps {
  send: (msg: ClientMessage) => void;
}

export function FacilitatorMenu({ send }: FacilitatorMenuProps) {
  const [open, setOpen] = useState(false);
  const isBlurred = useBoardStore((s) => s.board?.is_blurred ?? true);
  const hideVotes = useBoardStore((s) => s.board?.hide_votes ?? false);
  const facilitatorPeek = useBoardStore((s) => s.facilitatorPeek);
  const toggleFacilitatorPeek = useBoardStore((s) => s.toggleFacilitatorPeek);
  const isFacilitator = useBoardStore((s) => s.isFacilitator);
  const boardId = useBoardStore((s) => s.board?.id);
  const editors = useBoardStore((s) => s.board?.editors ?? []);
  const editorRequests = useBoardStore((s) => s.board?.editor_requests ?? []);

  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-8 h-8 flex flex-col items-center justify-center gap-1 rounded-lg border border-border hover:border-accent/40 hover:text-accent transition-colors"
        aria-label="Board settings"
      >
        <span
          className={`block w-4 h-0.5 bg-current transition-transform duration-200 ${
            open ? "translate-y-[3px] rotate-45" : ""
          }`}
        />
        <span
          className={`block w-4 h-0.5 bg-current transition-opacity duration-200 ${
            open ? "opacity-0" : ""
          }`}
        />
        <span
          className={`block w-4 h-0.5 bg-current transition-transform duration-200 ${
            open ? "-translate-y-[3px] -rotate-45" : ""
          }`}
        />
        {isFacilitator && editorRequests.length > 0 && !open && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-semibold leading-none px-1">
            {editorRequests.length}
          </span>
        )}
      </button>

      {/* Backdrop + Panel — portaled to body to escape header's stacking context */}
      {open && createPortal(
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-ink/20 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-0 right-0 h-full w-80 max-w-[90vw] bg-surface border-l border-border shadow-xl animate-slide-in-right flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-display font-semibold text-base">Board Settings</h2>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-canvas transition-colors text-muted hover:text-ink"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
              {/* Blur Toggle */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Card Visibility</span>
                  <button
                    onClick={() => send({ type: "ToggleBlur" })}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      isBlurred
                        ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                        : "border-border hover:bg-canvas"
                    }`}
                  >
                    {isBlurred ? "Reveal Cards" : "Blur Cards"}
                  </button>
                </div>
                <p className="text-xs text-muted mt-1">
                  {isBlurred
                    ? "Cards are hidden. Authors can still see their own."
                    : "All cards are visible to everyone."}
                </p>
                {isBlurred && (
                  <button
                    onClick={toggleFacilitatorPeek}
                    className={`mt-2 px-3 py-1.5 text-sm rounded-lg border transition-colors w-full ${
                      facilitatorPeek
                        ? "border-amber-400 bg-amber-400/10 text-amber-600 hover:bg-amber-400/20"
                        : "border-border hover:bg-canvas"
                    }`}
                  >
                    {facilitatorPeek ? "Stop Peeking" : "Peek at Cards"}
                  </button>
                )}
              </div>

              <hr className="border-border" />

              {/* Hide Votes Toggle */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Vote Visibility</span>
                  <button
                    onClick={() => send({ type: "ToggleHideVotes" })}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      hideVotes
                        ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                        : "border-border hover:bg-canvas"
                    }`}
                  >
                    {hideVotes ? "Show Votes" : "Hide Votes"}
                  </button>
                </div>
                <p className="text-xs text-muted mt-1">
                  {hideVotes
                    ? "Vote counts are hidden. Participants can still vote."
                    : "Vote counts are visible to everyone."}
                </p>
              </div>

              <hr className="border-border" />

              {/* Vote Limit */}
              <VoteLimitControl send={send} />

              <hr className="border-border" />

              {/* Timer */}
              <TimerControl send={send} />

              {boardId && (
                <>
                  <hr className="border-border" />

                  {/* Labels */}
                  <BoardLabelsControl boardId={boardId} />

                  <hr className="border-border" />

                  {/* Actions of an earlier retro */}
                  <CarryActionsPanel boardId={boardId} />

                  {/* The lock on the board belongs to whoever called the meeting */}
                  {isFacilitator && (
                    <>
                      <hr className="border-border" />
                      <BoardPasswordControl boardId={boardId} />
                    </>
                  )}
                </>
              )}

              {/* Editors & Requests — facilitator only */}
              {isFacilitator && (editors.length > 0 || editorRequests.length > 0) && (
                <>
                  <hr className="border-border" />
                  <div>
                    <span className="text-sm font-medium">Editors</span>

                    {editors.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {editors.map((editor) => (
                          <div
                            key={editor.participant_id}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-canvas border border-border"
                          >
                            <span className="text-sm truncate">
                              {editor.participant_name || editor.participant_id}
                            </span>
                            <button
                              onClick={() =>
                                send({
                                  type: "RemoveEditor",
                                  payload: { participant_id: editor.participant_id },
                                })
                              }
                              className="px-2 py-1 text-xs rounded-md text-muted hover:text-red-600 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-colors shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {editors.length === 0 && editorRequests.length === 0 && (
                      <p className="text-xs text-muted mt-1">No editors yet.</p>
                    )}

                    {editorRequests.length > 0 && (
                      <div className="mt-3">
                        <span className="text-xs font-medium text-muted uppercase tracking-wide">
                          Pending Requests
                        </span>
                        <div className="mt-1.5 space-y-2">
                          {editorRequests.map((req) => (
                            <div
                              key={req.participant_id}
                              className="flex items-center justify-between gap-2 p-2 rounded-lg bg-canvas border border-border"
                            >
                              <span className="text-sm truncate">{req.participant_name}</span>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={() =>
                                    send({
                                      type: "ApproveEditor",
                                      payload: { participant_id: req.participant_id },
                                    })
                                  }
                                  className="px-2 py-1 text-xs rounded-md bg-green-500/10 text-green-600 border border-green-500/30 hover:bg-green-500/20 transition-colors"
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={() =>
                                    send({
                                      type: "DeclineEditor",
                                      payload: { participant_id: req.participant_id },
                                    })
                                  }
                                  className="px-2 py-1 text-xs rounded-md bg-red-500/10 text-red-600 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
