import { useBoardStore } from "../../store/boardStore";

export function SortControls() {
  const { sortMode, setSortMode } = useBoardStore();
  const hideVotes = useBoardStore((s) => s.board?.hide_votes ?? false);
  const effective = hideVotes ? "newest" : sortMode;

  return (
    <div className="flex items-center gap-1 text-sm">
      <button
        onClick={() => !hideVotes && setSortMode("newest")}
        disabled={hideVotes}
        className={`px-2 py-1 rounded transition-colors ${
          effective === "newest" ? "bg-ink text-canvas" : "text-muted hover:text-ink"
        } ${hideVotes ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Newest
      </button>
      <button
        onClick={() => !hideVotes && setSortMode("most-votes")}
        disabled={hideVotes}
        className={`px-2 py-1 rounded transition-colors ${
          effective === "most-votes" ? "bg-ink text-canvas" : "text-muted hover:text-ink"
        } ${hideVotes ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Top Voted
      </button>
    </div>
  );
}
