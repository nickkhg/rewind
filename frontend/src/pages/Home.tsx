import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Logo } from "../components/layout/Logo";
import { createBoard, fetchMyBoards } from "../lib/api";
import type { MyBoardSummary } from "../lib/types";

const DEFAULT_COLUMNS = ["Went Well", "To Improve", "Action Items"];

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Home() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [name, setName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [myBoards, setMyBoards] = useState<MyBoardSummary[]>([]);

  useEffect(() => {
    fetchMyBoards()
      .then(setMyBoards)
      .catch(() => {});
  }, []);

  function updateColumn(index: number, value: string) {
    setColumns((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  function addColumn() {
    if (columns.length < 5) setColumns((prev) => [...prev, ""]);
  }

  function removeColumn(index: number) {
    if (columns.length > 1) setColumns((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedTitle = title.trim();
    const trimmedName = name.trim();
    const trimmedCols = columns.map((c) => c.trim()).filter(Boolean);

    if (!trimmedTitle) return setError("Board title is required");
    if (!isAnonymous && !trimmedName) return setError("Your name is required");
    if (trimmedCols.length === 0) return setError("At least one column is required");

    setLoading(true);
    try {
      const res = await createBoard({
        title: trimmedTitle,
        columns: trimmedCols,
        is_anonymous: isAnonymous || undefined,
      });
      if (isAnonymous) {
        sessionStorage.setItem(`participant_name_${res.board.id}`, "__anonymous__");
      } else {
        sessionStorage.setItem(`participant_name_${res.board.id}`, trimmedName);
      }
      navigate(`/board/${res.board.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <Logo className="text-5xl text-accent" />
          <p className="mt-3 text-muted text-lg">Run your retro, together.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-2xl shadow-sm border border-border p-8 space-y-6"
        >
          {!isAnonymous && (
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1.5">
                Your name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
              />
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1.5">
              Board title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sprint 42 Retro"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Columns</label>
            <div className="space-y-2">
              {columns.map((col, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={col}
                    onChange={(e) => updateColumn(i, e.target.value)}
                    placeholder={`Column ${i + 1}`}
                    className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
                  />
                  {columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColumn(i)}
                      className="px-2 text-muted hover:text-ink transition-colors"
                      aria-label="Remove column"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
            {columns.length < 5 && (
              <button
                type="button"
                onClick={addColumn}
                className="mt-2 text-sm text-accent hover:text-accent-hover transition-colors"
              >
                + Add column
              </button>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              role="switch"
              aria-checked={isAnonymous}
              onClick={() => setIsAnonymous((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                isAnonymous ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                  isAnonymous ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <div className="select-none">
              <span className="text-sm font-medium">Anonymous board</span>
              <span className="text-xs text-muted ml-1.5">— no names shown</span>
            </div>
          </label>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-white font-medium py-2.5 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {loading ? "Creating..." : "Start Retro"}
          </button>
        </form>

        {myBoards.length > 0 && (
          <div className="mt-10 animate-card-enter">
            <h2 className="font-display text-lg font-semibold mb-4 text-ink/80">Your boards</h2>
            <div className="space-y-2">
              {myBoards.map((b, i) => (
                <Link
                  key={b.id}
                  to={`/board/${b.id}`}
                  className="group block bg-surface rounded-xl border border-border px-5 py-3.5 hover:border-accent/40 hover:shadow-sm transition-all"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-display font-medium text-ink group-hover:text-accent transition-colors truncate block">
                        {b.title}
                      </span>
                      <span className="text-xs text-muted mt-0.5 block">
                        {b.column_count} {b.column_count === 1 ? "column" : "columns"}
                        {" \u00B7 "}
                        {b.ticket_count} {b.ticket_count === 1 ? "card" : "cards"}
                        {b.is_anonymous && " \u00B7 anonymous"}
                      </span>
                    </div>
                    <span className="text-xs text-muted whitespace-nowrap shrink-0">
                      {formatRelativeDate(b.created_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="text-center mt-4">
          <a
            href="/admin"
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            Admin
          </a>
        </p>
      </div>
    </div>
  );
}
