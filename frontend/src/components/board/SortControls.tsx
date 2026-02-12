import { useBoardStore } from "../../store/boardStore";

export function SortControls() {
  const { sortMode, setSortMode } = useBoardStore();

  return (
    <div className="flex items-center gap-1 text-sm">
      <button
        onClick={() => setSortMode("newest")}
        className={`px-2 py-1 rounded transition-colors ${
          sortMode === "newest" ? "bg-ink text-white" : "text-muted hover:text-ink"
        }`}
      >
        Newest
      </button>
      <button
        onClick={() => setSortMode("most-votes")}
        className={`px-2 py-1 rounded transition-colors ${
          sortMode === "most-votes" ? "bg-ink text-white" : "text-muted hover:text-ink"
        }`}
      >
        Top Voted
      </button>
    </div>
  );
}
