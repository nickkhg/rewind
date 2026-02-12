import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useBoardStore } from "../store/boardStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { BoardHeader } from "../components/board/BoardHeader";
import { Column } from "../components/board/Column";
import { COLUMN_COLORS } from "../lib/types";
import { AppShell } from "../components/layout/AppShell";

export default function Board() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const board = useBoardStore((s) => s.board);
  const reset = useBoardStore((s) => s.reset);

  // Check for participant name — prompt if missing (joined via shared link)
  const [participantName, setParticipantName] = useState(() => {
    return sessionStorage.getItem(`participant_name_${id}`) ?? "";
  });
  const [nameInput, setNameInput] = useState("");

  const { send } = useWebSocket(id ?? "", participantName);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  if (!id) {
    navigate("/");
    return null;
  }

  // Name entry for participants who joined via shared link
  if (!participantName) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-border p-8">
          <h2 className="font-display text-xl font-semibold mb-4">Join the retro</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = nameInput.trim();
              if (trimmed) {
                sessionStorage.setItem(`participant_name_${id}`, trimmed);
                setParticipantName(trimmed);
              }
            }}
          >
            <label htmlFor="join-name" className="block text-sm font-medium mb-1.5">
              Your name
            </label>
            <input
              id="join-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
              autoFocus
            />
            <button
              type="submit"
              className="mt-4 w-full bg-accent text-white font-medium py-2.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Connecting...</p>
      </div>
    );
  }

  return (
    <AppShell>
      <BoardHeader send={send} />
      <main className="flex-1 overflow-x-auto">
        <div className="max-w-[1400px] mx-auto px-4 py-6">
          <div className="flex gap-6">
            {board.columns.map((col, i) => (
              <Column
                key={col.id}
                column={col}
                color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
                send={send}
              />
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
