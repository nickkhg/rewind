import { useState, useEffect } from "react";
import { useBoardStore } from "../../store/boardStore";

export function TimerDisplay() {
  const timerEnd = useBoardStore((s) => s.board?.timer_end ?? null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!timerEnd) {
      setRemaining(null);
      return;
    }

    function tick() {
      const diff = Math.max(0, Math.floor((new Date(timerEnd!).getTime() - Date.now()) / 1000));
      setRemaining(diff);
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timerEnd]);

  if (remaining === null || remaining <= 0 && !timerEnd) return null;

  // Timer expired
  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent/10 border border-accent/30 animate-timer-pulse">
        <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="text-sm font-semibold text-accent">Time's up!</span>
      </div>
    );
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isUrgent = remaining <= 30;

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border ${
        isUrgent
          ? "bg-accent/10 border-accent/30 animate-timer-pulse"
          : "bg-canvas border-border"
      }`}
    >
      <svg className={`w-4 h-4 ${isUrgent ? "text-accent" : "text-muted"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span
        className={`text-sm font-semibold tabular-nums font-mono ${
          isUrgent ? "text-accent" : "text-ink"
        }`}
      >
        {minutes}:{seconds.toString().padStart(2, "0")}
      </span>
    </div>
  );
}
