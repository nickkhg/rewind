import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/layout/Logo";
import { createBoard } from "../lib/api";

const DEFAULT_COLUMNS = ["Went Well", "To Improve", "Action Items"];

export default function Home() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (!trimmedName) return setError("Your name is required");
    if (trimmedCols.length === 0) return setError("At least one column is required");

    setLoading(true);
    try {
      const res = await createBoard({ title: trimmedTitle, columns: trimmedCols });
      sessionStorage.setItem(`facilitator_${res.board.id}`, res.facilitator_token);
      sessionStorage.setItem(`participant_name_${res.board.id}`, trimmedName);
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
          className="bg-white rounded-2xl shadow-sm border border-border p-8 space-y-6"
        >
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
      </div>
    </div>
  );
}
