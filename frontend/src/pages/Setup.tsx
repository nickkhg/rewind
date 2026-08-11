import { useState } from "react";
import { setServerUrl } from "../lib/serverUrl";
import type { Health } from "../lib/types";

export default function Setup({ onComplete }: { onComplete: () => void }) {
  const [url, setUrl] = useState("http://localhost:3001");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "success" | "error" | "needs-sign-in"
  >("idle");
  const [error, setError] = useState("");

  async function testConnection() {
    setTesting(true);
    setStatus("idle");
    setError("");

    const trimmed = url.trim().replace(/\/+$/, "");
    try {
      // The health route, because it is the one that answers without an account. Testing a real
      // route against a server that asks for one would come back 401 and read as "unreachable".
      const res = await fetch(`${trimmed}/api/health`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const health: Health = await res.json();
      setStatus(health.auth_required ? "needs-sign-in" : "success");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Could not reach the server",
      );
    } finally {
      setTesting(false);
    }
  }

  function handleContinue() {
    const trimmed = url.trim().replace(/\/+$/, "");
    setServerUrl(trimmed);
    onComplete();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-card-enter">
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl font-semibold tracking-tight text-accent">
            Rewind
          </h1>
          <p className="mt-3 text-muted text-lg">
            Connect to your Rewind server to get started.
          </p>
        </div>

        <div className="bg-surface rounded-2xl shadow-sm border border-border p-8 space-y-6">
          <div>
            <label
              htmlFor="server-url"
              className="block text-sm font-medium mb-1.5"
            >
              Server URL
            </label>
            <p className="text-xs text-muted mb-3">
              The address where your Rewind backend is running.
            </p>
            <input
              id="server-url"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setStatus("idle");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (status === "success") handleContinue();
                  else testConnection();
                }
              }}
              placeholder="http://localhost:3001"
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas font-mono"
              autoFocus
            />
          </div>

          {status === "success" && (
            <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5 animate-card-enter">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
              </svg>
              Connected successfully
            </p>
          )}

          {status === "needs-sign-in" && (
            <p className="text-sm text-muted animate-card-enter">
              This server signs people in with their work account, and the desktop
              app cannot run that sign-in yet. Open it in your browser instead.
            </p>
          )}

          {status === "error" && (
            <p className="text-sm text-red-600 animate-card-enter">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !url.trim()}
              className="flex-1 border border-border text-ink font-medium py-2.5 rounded-lg hover:bg-canvas transition-colors disabled:opacity-50"
            >
              {testing ? "Testing\u2026" : "Test Connection"}
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={status !== "success"}
              className="flex-1 bg-accent text-white font-medium py-2.5 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-30"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
