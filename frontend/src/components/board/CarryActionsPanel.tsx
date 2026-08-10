import { useEffect, useState } from "react";
import { fetchActionSources, fetchBoard, fetchLabels, importActions } from "../../lib/api";
import { formatRelativeDate } from "../../utils/date";
import type { ActionSourceBoard, ImportResult } from "../../lib/types";

interface CarryActionsPanelProps {
  boardId: string;
}

/**
 * Copies the actions of an earlier retro into the Previous Actions column of this board.
 * Any board can supply them, whoever runs it.
 */
export function CarryActionsPanel({ boardId }: CarryActionsPanelProps) {
  const [sources, setSources] = useState<ActionSourceBoard[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [activeLabels, setActiveLabels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<ActionSourceBoard | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    fetchLabels()
      .then((counts) => setLabels(counts.map((c) => c.label)))
      .catch(() => {});
  }, []);

  // Reload the list when the search or the label filter changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchActionSources(boardId, { q: search, labels: activeLabels })
        .then((boards) => {
          if (cancelled) return;
          setSources(boards);
          setError("");
        })
        .catch(() => {
          if (!cancelled) setError("The list of boards did not load. Try again.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [boardId, search, activeLabels]);

  function toggleLabel(label: string) {
    setActiveLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  }

  async function select(board: ActionSourceBoard) {
    setResult(null);
    if (selected?.id === board.id) {
      setSelected(null);
      setPreview(null);
      return;
    }
    setSelected(board);
    setPreview(null);
    try {
      const full = await fetchBoard(board.id);
      const actions = full.columns.find((c) => c.role === "actions");
      setPreview((actions?.tickets ?? []).map((t) => t.content));
    } catch {
      setPreview([]);
    }
  }

  async function copy() {
    if (!selected) return;
    setCopying(true);
    setError("");
    try {
      setResult(await importActions(boardId, selected.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The copy did not run.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <div>
      <span className="text-sm font-medium">Carry over actions</span>
      <p className="text-xs text-muted mt-1">
        Copy the actions of an earlier retro into Previous Actions.
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search boards"
        className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
      />

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleLabel(label)}
              className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                activeLabels.includes(label)
                  ? "border-accent/30 bg-accent/[0.06] text-accent"
                  : "border-border bg-canvas text-muted hover:border-accent/30 hover:text-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
        {loading && <p className="text-xs text-muted">Loading boards…</p>}

        {!loading && sources.length === 0 && (
          <p className="text-xs text-muted">
            {activeLabels.length > 0 || search
              ? "No board matches this filter."
              : "No board has actions to carry yet."}
          </p>
        )}

        {!loading &&
          sources.map((board) => (
            <div key={board.id}>
              <button
                type="button"
                onClick={() => select(board)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                  selected?.id === board.id
                    ? "border-accent/40 bg-accent/[0.06]"
                    : "border-border bg-canvas hover:border-accent/30"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium truncate">{board.title}</span>
                  <span className="text-[11px] text-muted whitespace-nowrap shrink-0">
                    {formatRelativeDate(board.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className="text-[11px] text-muted">
                    {board.action_count} {board.action_count === 1 ? "action" : "actions"}
                  </span>
                  {board.labels.map((label) => (
                    <span
                      key={label}
                      className="text-[11px] px-1.5 py-0.5 rounded-md border border-border text-muted"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </button>

              {selected?.id === board.id && (
                <div className="mt-2 rounded-lg border border-border bg-surface p-3 animate-card-enter">
                  {preview === null && <p className="text-xs text-muted">Loading actions…</p>}
                  {preview !== null && (
                    <ul className="space-y-1.5">
                      {preview.slice(0, 6).map((content, i) => (
                        <li key={i} className="text-xs text-ink/80 line-clamp-2">
                          {content}
                        </li>
                      ))}
                      {preview.length > 6 && (
                        <li className="text-xs text-muted">
                          and {preview.length - 6} more
                        </li>
                      )}
                    </ul>
                  )}

                  <button
                    type="button"
                    onClick={copy}
                    disabled={copying || preview === null || preview.length === 0}
                    className="mt-3 w-full bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40"
                  >
                    {copying
                      ? "Copying…"
                      : `Copy ${board.action_count} ${
                          board.action_count === 1 ? "action" : "actions"
                        }`}
                  </button>

                  {result && (
                    <p className="text-xs text-muted mt-2">
                      Copied {result.imported}{" "}
                      {result.imported === 1 ? "action" : "actions"}.
                      {result.skipped > 0 && ` Skipped ${result.skipped} already here.`}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
