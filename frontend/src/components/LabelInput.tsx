import { useState } from "react";

/** Puts a label into the form that the server keeps: lower case, one space between words. */
export function normalizeLabel(raw: string): string {
  return raw.trim().split(/\s+/).join(" ").toLowerCase();
}

interface LabelInputProps {
  labels: string[];
  onChange: (labels: string[]) => void;
  /** Labels that other boards already use. */
  suggestions?: string[];
  max?: number;
  placeholder?: string;
  id?: string;
}

/**
 * Collects the labels of a board. Type a word and press Enter to add it, or pick one of the
 * labels that other boards already use.
 */
export function LabelInput({
  labels,
  onChange,
  suggestions = [],
  max = 6,
  placeholder = "e.g. sprint retro",
  id,
}: LabelInputProps) {
  const [draft, setDraft] = useState("");
  const full = labels.length >= max;

  function add(raw: string) {
    const label = normalizeLabel(raw);
    setDraft("");
    if (!label || label.length > 40 || labels.includes(label) || full) return;
    onChange([...labels, label]);
  }

  function remove(label: string) {
    onChange(labels.filter((l) => l !== label));
  }

  const typed = normalizeLabel(draft);
  const matches = suggestions
    .filter((s) => !labels.includes(s) && (!typed || s.includes(typed)))
    .slice(0, 6);

  return (
    <div>
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {labels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-accent/30 bg-accent/[0.06] text-accent"
            >
              {label}
              <button
                type="button"
                onClick={() => remove(label)}
                className="text-accent/60 hover:text-accent transition-colors"
                aria-label={`Remove ${label}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        id={id}
        type="text"
        value={draft}
        disabled={full}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          }
          if (e.key === "Backspace" && !draft && labels.length > 0) {
            remove(labels[labels.length - 1]);
          }
        }}
        onBlur={() => add(draft)}
        placeholder={full ? `${max} labels is the limit` : placeholder}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas disabled:opacity-50"
      />

      {matches.length > 0 && !full && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {matches.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => add(label)}
              className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-canvas text-muted hover:border-accent/30 hover:text-accent transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
