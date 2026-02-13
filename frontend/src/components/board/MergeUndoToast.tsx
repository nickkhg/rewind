import { useEffect, useRef } from "react";
import { useBoardStore } from "../../store/boardStore";
import type { ClientMessage } from "../../lib/types";

interface MergeUndoToastProps {
  send: (msg: ClientMessage) => void;
}

export function MergeUndoToast({ send }: MergeUndoToastProps) {
  const pendingUndo = useBoardStore((s) => s.pendingUndo);
  const clearPendingUndo = useBoardStore((s) => s.clearPendingUndo);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!pendingUndo) return;
    timerRef.current = setTimeout(() => {
      clearPendingUndo();
    }, 10_000);
    return () => clearTimeout(timerRef.current);
  }, [pendingUndo, clearPendingUndo]);

  if (!pendingUndo) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-card-enter">
      <div className="flex items-center gap-3 bg-surface border border-border shadow-lg rounded-lg px-4 py-2.5">
        <span className="text-sm">Tickets merged</span>
        <button
          onClick={() => {
            send({ type: "UndoMerge" });
            clearPendingUndo();
          }}
          className="text-sm font-medium text-accent hover:text-accent-hover underline underline-offset-2"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
