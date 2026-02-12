import { useEffect, useState } from "react";

function getInitialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = () =>
    setTheme((t) => (t === "light" ? "dark" : "light"));
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className="fixed bottom-5 right-5 z-50 w-10 h-10 rounded-full grid place-items-center border border-border/40 backdrop-blur-md cursor-pointer hover:scale-110 active:scale-95 transition-transform"
      style={{
        backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        color: isDark ? "#c4b5a4" : "var(--color-accent)",
        boxShadow: isDark
          ? "0 2px 20px rgba(196, 181, 164, 0.08)"
          : "0 2px 20px rgba(224, 122, 95, 0.12)",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
        stroke="none"
        style={{
          transition:
            "transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          transform: isDark ? "rotate(180deg)" : "rotate(0deg)",
        }}
      >
        <defs>
          <mask id="moon-cutout">
            <rect width="24" height="24" fill="white" />
            <circle
              cx="16"
              cy="8"
              r="5.5"
              fill="black"
              style={{
                transition:
                  "transform 500ms cubic-bezier(0.4, 0, 0.2, 1)",
                transform: isDark
                  ? "translateX(0)"
                  : "translateX(16px)",
              }}
            />
          </mask>
        </defs>

        {/* Sun rays — collapse to center in dark mode */}
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          style={{
            transition:
              "opacity 200ms ease, transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            opacity: isDark ? 0 : 1,
            transformOrigin: "center",
            transform: isDark ? "scale(0)" : "scale(1)",
          }}
        >
          <line x1="12" y1="1" x2="12" y2="3.5" />
          <line x1="12" y1="20.5" x2="12" y2="23" />
          <line x1="1" y1="12" x2="3.5" y2="12" />
          <line x1="20.5" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="4.22" x2="5.99" y2="5.99" />
          <line x1="18.01" y1="18.01" x2="19.78" y2="19.78" />
          <line x1="19.78" y1="4.22" x2="18.01" y2="5.99" />
          <line x1="5.99" y1="18.01" x2="4.22" y2="19.78" />
        </g>

        {/* Sun / Moon body — mask carves the crescent */}
        <circle cx="12" cy="12" r="5" mask="url(#moon-cutout)" />

        {/* Tiny stars fade in for dark mode */}
        <circle
          cx="6"
          cy="6"
          r="0.75"
          style={{
            opacity: isDark ? 0.7 : 0,
            transition: "opacity 400ms ease 200ms",
          }}
        />
        <circle
          cx="19.5"
          cy="16"
          r="0.5"
          style={{
            opacity: isDark ? 0.5 : 0,
            transition: "opacity 400ms ease 300ms",
          }}
        />
        <circle
          cx="7"
          cy="19"
          r="0.5"
          style={{
            opacity: isDark ? 0.6 : 0,
            transition: "opacity 400ms ease 350ms",
          }}
        />
      </svg>
    </button>
  );
}
