import { useBoardStore } from "../../store/boardStore";
import type { ClientMessage } from "../../lib/types";

interface TimerControlProps {
  send: (msg: ClientMessage) => void;
}

const PRESETS = [
  { label: "1 min", secs: 60 },
  { label: "2 min", secs: 120 },
  { label: "3 min", secs: 180 },
  { label: "5 min", secs: 300 },
  { label: "10 min", secs: 600 },
];

export function TimerControl({ send }: TimerControlProps) {
  const timerEnd = useBoardStore((s) => s.board?.timer_end ?? null);
  const isActive = timerEnd !== null && new Date(timerEnd) > new Date();

  function handleStart(secs: number) {
    send({ type: "StartTimer", payload: { duration_secs: secs } });
  }

  function handleStop() {
    send({ type: "StopTimer" });
  }

  return (
    <div>
      <span className="text-sm font-medium block mb-2">Discussion Timer</span>
      {isActive ? (
        <button
          onClick={handleStop}
          className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-600 border border-red-200 hover:bg-red-500/20 transition-colors"
        >
          Stop Timer
        </button>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.secs}
              onClick={() => handleStart(p.secs)}
              className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-canvas hover:border-accent/40 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
