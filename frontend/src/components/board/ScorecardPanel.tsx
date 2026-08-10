import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "../../store/boardStore";
import { MAX_SCORECARD_FIELD_LENGTH } from "../../lib/types";
import type { ClientMessage, ScorecardMetric } from "../../lib/types";

function statusLabel(onTrack: boolean | null): string {
  if (onTrack === null) return "Not set";
  return onTrack ? "On track" : "Off track";
}

/** The same two tints a rock carries, so the whole board speaks one status vocabulary. */
function statusClass(onTrack: boolean | null): string {
  if (onTrack === null) return "border-dashed border-border text-muted";
  return onTrack
    ? "border-green-500/30 bg-green-500/10 text-green-600"
    : "border-red-500/30 bg-red-500/10 text-red-600";
}

/** The mark of one line in the run that the closed strip shows. */
function markClass(onTrack: boolean | null): string {
  if (onTrack === null) return "border border-border";
  return onTrack ? "bg-green-500" : "bg-red-500";
}

/** Not set -> on track -> off track -> not set. */
function nextStatus(onTrack: boolean | null): boolean | null {
  if (onTrack === null) return true;
  return onTrack ? false : null;
}

/** A cell you can type in: quiet at rest, framed when you reach for it. */
const CELL_INPUT =
  "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-border focus:border-border focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-accent/40 transition-colors";

interface MetricRowProps {
  metric: ScorecardMetric;
  isPrivileged: boolean;
  send: (msg: ClientMessage) => void;
}

function MetricRow({ metric, isPrivileged, send }: MetricRowProps) {
  const [name, setName] = useState(metric.name);
  const [goal, setGoal] = useState(metric.goal);
  const [actual, setActual] = useState(metric.actual);

  // Another person can change the line while you look at it. The board is the record.
  useEffect(() => {
    setName(metric.name);
    setGoal(metric.goal);
    setActual(metric.actual);
  }, [metric.name, metric.goal, metric.actual]);

  /** Sends the whole line, as an edit of a card does. Nothing goes out when nothing moved. */
  function commit(change: { on_track?: boolean | null } = {}) {
    const trimmedName = name.trim();
    // The server refuses a line with no name, so put the old name back instead.
    if (!trimmedName) {
      setName(metric.name);
      return;
    }
    const onTrack = change.on_track !== undefined ? change.on_track : metric.on_track;
    if (
      trimmedName === metric.name &&
      goal === metric.goal &&
      actual === metric.actual &&
      onTrack === metric.on_track
    ) {
      return;
    }
    send({
      type: "UpdateScorecardMetric",
      payload: {
        metric_id: metric.id,
        name: trimmedName,
        goal,
        actual,
        on_track: onTrack,
      },
    });
  }

  function revert() {
    setName(metric.name);
    setGoal(metric.goal);
    setActual(metric.actual);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      revert();
      e.currentTarget.blur();
    }
  }

  return (
    <tr className="group/row border-t border-border/60">
      <td className="py-1 pr-3">
        {isPrivileged ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={handleKeyDown}
            maxLength={MAX_SCORECARD_FIELD_LENGTH}
            aria-label="Metric"
            className={CELL_INPUT}
          />
        ) : (
          <span className="block px-1.5 py-1 text-sm">{metric.name}</span>
        )}
      </td>
      <td className="py-1 pr-3">
        {isPrivileged ? (
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={handleKeyDown}
            maxLength={MAX_SCORECARD_FIELD_LENGTH}
            placeholder="—"
            aria-label={`Goal for ${metric.name}`}
            className={`${CELL_INPUT} tabular-nums placeholder:text-muted`}
          />
        ) : (
          <span className="block px-1.5 py-1 text-sm tabular-nums">{metric.goal || "—"}</span>
        )}
      </td>
      <td className="py-1 pr-3">
        {isPrivileged ? (
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={handleKeyDown}
            maxLength={MAX_SCORECARD_FIELD_LENGTH}
            placeholder="—"
            aria-label={`This week for ${metric.name}`}
            className={`${CELL_INPUT} tabular-nums placeholder:text-muted`}
          />
        ) : (
          <span className="block px-1.5 py-1 text-sm tabular-nums">{metric.actual || "—"}</span>
        )}
      </td>
      <td className="py-1 pr-3">
        {isPrivileged ? (
          <button
            onClick={() => commit({ on_track: nextStatus(metric.on_track) })}
            title={`${statusLabel(metric.on_track)}. Click for ${statusLabel(
              nextStatus(metric.on_track),
            ).toLowerCase()}.`}
            className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-opacity hover:opacity-75 ${statusClass(
              metric.on_track,
            )}`}
          >
            {statusLabel(metric.on_track)}
          </button>
        ) : (
          <span
            className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${statusClass(
              metric.on_track,
            )}`}
          >
            {statusLabel(metric.on_track)}
          </span>
        )}
      </td>
      {isPrivileged && (
        <td className="py-1 text-right">
          <button
            onClick={() =>
              send({ type: "RemoveScorecardMetric", payload: { metric_id: metric.id } })
            }
            aria-label={`Remove ${metric.name}`}
            title="Remove this metric"
            className="w-6 h-6 rounded-md text-muted opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-opacity"
          >
            &times;
          </button>
        </td>
      )}
    </tr>
  );
}

interface ScorecardPanelProps {
  send: (msg: ClientMessage) => void;
}

/**
 * The numbers a Level 10 team reads every week, in a strip above the board. It rests closed
 * and still says how the week went: one mark per line, and the count of the lines that missed.
 */
export function ScorecardPanel({ send }: ScorecardPanelProps) {
  const metrics = useBoardStore((s) => s.board?.scorecard ?? []);
  const isFacilitator = useBoardStore((s) => s.isFacilitator);
  const participantId = useBoardStore((s) => s.participantId);
  const editors = useBoardStore((s) => s.board?.editors ?? []);
  const isPrivileged =
    isFacilitator ||
    !!(participantId && editors.some((e) => e.participant_id === participantId));

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);

  const onTrackCount = metrics.filter((m) => m.on_track === true).length;
  const offTrackCount = metrics.filter((m) => m.on_track === false).length;
  const unsetCount = metrics.length - onTrackCount - offTrackCount;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    send({
      type: "AddScorecardMetric",
      payload: { name: trimmed, goal: newGoal.trim() },
    });
    setNewName("");
    setNewGoal("");
    // A scorecard is set up in one sitting, so the row stays open for the next metric.
    newNameRef.current?.focus();
  }

  function startAdding() {
    setOpen(true);
    setAdding(true);
  }

  return (
    <section className="max-w-[1400px] mx-auto w-full px-4 pt-5">
      <div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="scorecard-body"
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-canvas transition-colors"
        >
          <svg
            className={`w-3 h-3 text-muted shrink-0 transition-transform duration-200 ${
              open ? "rotate-90" : ""
            }`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="4 2 8 6 4 10" />
          </svg>
          <span className="font-display font-semibold text-sm">Scorecard</span>

          {!open && metrics.length === 0 && (
            <span className="text-xs text-muted">Not set up yet</span>
          )}

          {!open && metrics.length > 0 && (
            <>
              <span className="flex items-center gap-1" aria-hidden>
                {metrics.map((m) => (
                  <span
                    key={m.id}
                    title={`${m.name}: ${statusLabel(m.on_track)}`}
                    className={`w-2 h-2 rounded-[2px] ${markClass(m.on_track)}`}
                  />
                ))}
              </span>
              <span className="sr-only">
                {onTrackCount} on track, {offTrackCount} off track, {unsetCount} not set
              </span>
              {offTrackCount > 0 && (
                <span className="text-xs font-medium text-red-600">
                  {offTrackCount} off track
                </span>
              )}
            </>
          )}
        </button>

        {open && (
          <div id="scorecard-body" className="border-t border-border px-4 py-3">
            {metrics.length === 0 ? (
              <p className="text-sm text-muted">
                {isPrivileged
                  ? "No metrics yet. Add the numbers this team reads every week."
                  : "No metrics yet. The facilitator sets these up."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted">
                      <th className="text-left font-medium pb-1.5 pr-3">Metric</th>
                      <th className="text-left font-medium pb-1.5 pr-3 w-[20%]">Goal</th>
                      <th className="text-left font-medium pb-1.5 pr-3 w-[20%]">This week</th>
                      <th className="text-left font-medium pb-1.5 pr-3 w-[108px]">Status</th>
                      {isPrivileged && (
                        <th className="w-8">
                          <span className="sr-only">Remove</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <MetricRow
                        key={metric.id}
                        metric={metric}
                        isPrivileged={isPrivileged}
                        send={send}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isPrivileged &&
              (adding ? (
                <form onSubmit={handleAdd} className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={newNameRef}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Metric"
                    maxLength={MAX_SCORECARD_FIELD_LENGTH}
                    aria-label="New metric"
                    autoFocus
                    className="flex-1 min-w-[160px] rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <input
                    value={newGoal}
                    onChange={(e) => setNewGoal(e.target.value)}
                    placeholder="Goal"
                    maxLength={MAX_SCORECARD_FIELD_LENGTH}
                    aria-label="Goal for the new metric"
                    className="w-32 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <button
                    type="submit"
                    disabled={!newName.trim()}
                    className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add metric
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setNewName("");
                      setNewGoal("");
                    }}
                    className="text-sm text-muted hover:text-ink transition-colors"
                  >
                    Done
                  </button>
                </form>
              ) : (
                <button
                  onClick={startAdding}
                  className="mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  + Add metric
                </button>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
