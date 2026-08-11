import { useEffect, useState } from "react";
import {
  fetchActionSources,
  fetchBoard,
  fetchLabels,
  importActions,
  unlockBoard,
} from "../../lib/api";
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

  // A locked source asks for its own password, unless this tab can open it already.
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");

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

  /**
   * Reads the actions of a source board.
   *
   * A locked board answers nothing until this tab holds its key, so the gate goes up here and
   * the panel asks for the password of that board. A caller who runs the source board, or who
   * opened it earlier in this session, is never asked.
   */
  async function loadPreview(board: ActionSourceBoard) {
    setPreview(null);
    try {
      const full = await fetchBoard(board.id);
      const actions = full.columns.find((c) => c.role === "actions");
      setPreview((actions?.tickets ?? []).map((t) => t.content));
      setNeedsPassword(false);
    } catch {
      if (board.is_locked) {
        setNeedsPassword(true);
      } else {
        setPreview([]);
      }
    }
  }

  async function select(board: ActionSourceBoard) {
    setResult(null);
    setNeedsPassword(false);
    setPassword("");
    setUnlockError("");
    if (selected?.id === board.id) {
      setSelected(null);
      setPreview(null);
      return;
    }
    setSelected(board);
    await loadPreview(board);
  }

  async function unlockSource() {
    if (!selected || !password.trim()) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      await unlockBoard(selected.id, password);
      setPassword("");
      await loadPreview(selected);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "The password is wrong.");
    } finally {
      setUnlocking(false);
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
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{board.title}</span>
                    {board.is_locked && (
                      <svg
                        className="w-3 h-3 shrink-0 self-center text-muted"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        role="img"
                        aria-label="Asks for a password"
                      >
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    )}
                  </span>
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
                  {needsPassword ? (
                    <>
                      <p className="text-xs text-muted">
                        This board asks for its own password before its actions can come across.
                      </p>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (unlockError) setUnlockError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") unlockSource();
                        }}
                        placeholder={`Password for ${board.title}`}
                        autoComplete="off"
                        className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={unlockSource}
                        disabled={unlocking || !password.trim()}
                        className="mt-2 w-full bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40"
                      >
                        {unlocking ? "Unlocking…" : "Unlock board"}
                      </button>
                      {unlockError && (
                        <p role="alert" className="text-xs text-red-600 mt-2">
                          {unlockError}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
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
                    </>
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
