import { useState, lazy, Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ThemeToggle } from "./components/ThemeToggle";
import { hasServerUrl, isTauri, clearServerUrl } from "./lib/serverUrl";
import Setup from "./pages/Setup";

const UpdateChecker = lazy(
  () => import("./components/layout/UpdateChecker")
);

export default function App() {
  const [ready, setReady] = useState(hasServerUrl);

  if (!ready) {
    return (
      <>
        <Setup onComplete={() => setReady(true)} />
        <ThemeToggle />
      </>
    );
  }

  return (
    <>
      <RouterProvider router={router} />
      <ThemeToggle />
      {isTauri() && (
        <Suspense>
          <UpdateChecker />
        </Suspense>
      )}
      {isTauri() && (
        <button
          onClick={() => {
            clearServerUrl();
            setReady(false);
          }}
          aria-label="Change server"
          title="Change server"
          className="fixed bottom-5 left-5 z-50 w-10 h-10 rounded-full grid place-items-center border border-border/40 backdrop-blur-md cursor-pointer hover:scale-110 active:scale-95 transition-transform"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-surface) 80%, transparent)",
            color: "var(--color-muted)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
            <circle cx="6" cy="18" r="1" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
    </>
  );
}
