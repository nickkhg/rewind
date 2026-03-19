import { useState } from "react";
import { createPortal } from "react-dom";
import { useBoardStore } from "../../store/boardStore";
import type { ClientMessage } from "../../lib/types";

interface EditorRequestButtonProps {
  send: (msg: ClientMessage) => void;
}

export function EditorRequestButton({ send }: EditorRequestButtonProps) {
  const { board, participantId } = useBoardStore();
  const [showNameModal, setShowNameModal] = useState(false);
  const [name, setName] = useState("");

  if (!board || !participantId) return null;

  const isPending = board.editor_requests.some(
    (r) => r.participant_id === participantId
  );
  const isEditor = board.editors.some((e) => e.participant_id === participantId);

  if (isEditor) return null;

  function handleRequest() {
    if (board?.is_anonymous) {
      setShowNameModal(true);
    } else {
      send({ type: "RequestEditor", payload: {} });
    }
  }

  function handleSubmitName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    send({ type: "RequestEditor", payload: { name: trimmed } });
    setShowNameModal(false);
  }

  return (
    <>
      <button
        onClick={handleRequest}
        disabled={isPending}
        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
          isPending
            ? "border-border text-muted cursor-not-allowed"
            : "border-accent/40 text-accent hover:bg-accent/10"
        }`}
      >
        {isPending ? "Pending..." : "Request Editor"}
      </button>

      {showNameModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-ink/20"
            onClick={() => setShowNameModal(false)}
          />
          <div className="relative bg-surface border border-border rounded-xl shadow-xl p-6 w-80">
            <h3 className="font-display font-semibold text-sm mb-3">
              Enter your name
            </h3>
            <p className="text-xs text-muted mb-3">
              This board is anonymous. The facilitator needs to know who you are
              to approve your request.
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitName();
                if (e.key === "Escape") setShowNameModal(false);
              }}
              placeholder="Your name"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSubmitName}
                disabled={!name.trim()}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send Request
              </button>
              <button
                onClick={() => setShowNameModal(false)}
                className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-canvas transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
