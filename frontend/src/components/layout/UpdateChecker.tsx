import { useEffect, useState, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";

type Phase =
  | { step: "checking" }
  | { step: "available"; version: string; update: Update }
  | { step: "downloading"; percent: number }
  | { step: "ready" }
  | { step: "no-update"; currentVersion: string }
  | { step: "error"; message: string };

export default function UpdateChecker() {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdates = useCallback(async (silent: boolean) => {
    try {
      setDismissed(false);
      setPhase({ step: "checking" });
      const update = await check();
      if (update) {
        setPhase({ step: "available", version: update.version, update });
      } else if (silent) {
        setPhase(null);
      } else {
        const currentVersion = await getVersion();
        setPhase({ step: "no-update", currentVersion });
      }
    } catch {
      if (silent) {
        setPhase(null);
      } else {
        setPhase({ step: "error", message: "Could not check for updates" });
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => checkForUpdates(true), 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    const unlisten = listen("check-for-updates", () => checkForUpdates(false));
    return () => { unlisten.then((fn) => fn()); };
  }, [checkForUpdates]);

  const install = useCallback(async (update: Update) => {
    try {
      let totalLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLength = event.data.contentLength;
          setPhase({ step: "downloading", percent: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent = totalLength
            ? Math.round((downloaded / totalLength) * 100)
            : 0;
          setPhase({ step: "downloading", percent });
        } else if (event.event === "Finished") {
          setPhase({ step: "ready" });
        }
      });

      await relaunch();
    } catch (err) {
      setPhase({
        step: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  }, []);

  if (!phase || dismissed || phase.step === "checking") return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 animate-fade-in"
      style={{ maxWidth: 340 }}
    >
      <div
        className="rounded-xl border border-border/60 px-4 py-3 backdrop-blur-xl"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--color-surface) 88%, transparent)",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        {phase.step === "available" && (
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                color: "var(--color-accent)",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold leading-tight"
                style={{ color: "var(--color-ink)" }}
              >
                Update available
              </p>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                Version {phase.version} is ready to install
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => install(phase.update)}
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "var(--color-accent-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "var(--color-accent)")
                  }
                >
                  Update now
                </button>
                <button
                  onClick={() => setDismissed(true)}
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    color: "var(--color-muted)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "var(--color-ink)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "var(--color-muted)")
                  }
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        )}

        {phase.step === "downloading" && (
          <div className="flex items-center gap-3">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                color: "var(--color-accent)",
              }}
            >
              <svg
                className="animate-spin"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold leading-tight"
                style={{ color: "var(--color-ink)" }}
              >
                Downloading update...
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${phase.percent}%`,
                    backgroundColor: "var(--color-accent)",
                  }}
                />
              </div>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                {phase.percent}%
              </p>
            </div>
          </div>
        )}

        {phase.step === "ready" && (
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in srgb, #22c55e 12%, transparent)",
                color: "#22c55e",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              Restarting...
            </p>
          </div>
        )}

        {phase.step === "no-update" && (
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in srgb, #22c55e 12%, transparent)",
                color: "#22c55e",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                You're up to date
              </p>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                Rewind v{phase.currentVersion} is the latest version
              </p>
              <button
                onClick={() => setDismissed(true)}
                className="mt-2 cursor-pointer text-xs font-medium transition-colors"
                style={{ color: "var(--color-muted)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--color-ink)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--color-muted)")
                }
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {phase.step === "error" && (
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in srgb, #ef4444 12%, transparent)",
                color: "#ef4444",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                Update failed
              </p>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                {phase.message}
              </p>
              <button
                onClick={() => setDismissed(true)}
                className="mt-2 cursor-pointer text-xs font-medium transition-colors"
                style={{ color: "var(--color-muted)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--color-ink)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--color-muted)")
                }
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
