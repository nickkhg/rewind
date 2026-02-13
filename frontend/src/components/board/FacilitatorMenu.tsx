import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBoardStore } from "../../store/boardStore";
import { VoteLimitControl } from "./VoteLimitControl";
import { TimerControl } from "./TimerControl";
import type { ClientMessage } from "../../lib/types";

interface FacilitatorMenuProps {
  send: (msg: ClientMessage) => void;
}

export function FacilitatorMenu({ send }: FacilitatorMenuProps) {
  const [open, setOpen] = useState(false);
  const isBlurred = useBoardStore((s) => s.board?.is_blurred ?? true);

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
              </div>

              <hr className="border-border" />

              {/* Vote Limit */}
              <VoteLimitControl send={send} />

              <hr className="border-border" />

              {/* Timer */}
              <TimerControl send={send} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
