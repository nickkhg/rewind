import { useBoardStore } from "../../store/boardStore";
import type { ClientMessage } from "../../lib/types";

interface BlurToggleProps {
  send: (msg: ClientMessage) => void;
}

export function BlurToggle({ send }: BlurToggleProps) {
  const isBlurred = useBoardStore((s) => s.board?.is_blurred ?? true);

  return (
    <button
      onClick={() => send({ type: "ToggleBlur" })}
      className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-canvas transition-colors"
    >
      {isBlurred ? "Reveal Cards" : "Blur Cards"}
    </button>
  );
}
