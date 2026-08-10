import { useEffect, useState } from "react";
import { useBoardStore } from "../../store/boardStore";
import { fetchLabels, updateBoardLabels } from "../../lib/api";
import { LabelInput } from "../LabelInput";

interface BoardLabelsControlProps {
  boardId: string;
}

/** Labels group the boards. The carry-over list filters by them. */
export function BoardLabelsControl({ boardId }: BoardLabelsControlProps) {
  const boardLabels = useBoardStore((s) => s.board?.labels);
  const [labels, setLabels] = useState<string[]>(boardLabels ?? []);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchLabels()
      .then((counts) => setSuggestions(counts.map((c) => c.label)))
      .catch(() => {});
  }, []);

  // Follow the board state, so that a change by another editor shows here too.
  useEffect(() => {
    if (boardLabels) setLabels(boardLabels);
  }, [boardLabels]);

  async function save(next: string[]) {
    setLabels(next);
    setError("");
    try {
      await updateBoardLabels(boardId, next);
    } catch {
      setError("The labels did not save. Try again.");
      setLabels(boardLabels ?? []);
    }
  }

  return (
    <div>
      <span className="text-sm font-medium">Labels</span>
      <p className="text-xs text-muted mt-1 mb-2">
        Group this board with the other retros of the same kind.
      </p>
      <LabelInput labels={labels} onChange={save} suggestions={suggestions} />
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
