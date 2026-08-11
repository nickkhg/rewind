import { Logo } from "./Logo";

/**
 * What the desktop app says about a server that asks for a work account.
 *
 * The sign-in is a browser flow, and the app is not a browser: it loads its pages from disk and
 * talks to the server from another origin, so the cookie the flow ends with has nowhere to live.
 * Rather than let every request fail on its own, the app says so once and points at the browser,
 * which can open the same board with the same link.
 */
export function SignInNotSupported({
  url,
  onChangeServer,
}: {
  url: string;
  onChangeServer: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <Logo className="text-5xl text-accent" />
        </div>

        <div className="bg-surface rounded-2xl shadow-sm border border-border p-8 space-y-5">
          <h2 className="font-display text-xl font-semibold">
            This server asks you to sign in
          </h2>
          <p className="text-sm text-muted">
            It signs people in with their work account, and the desktop app cannot
            run that sign-in yet. Open the server in your browser instead — the
            boards and the links are the same.
          </p>
          {url && (
            <p className="text-sm">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-accent underline decoration-border hover:decoration-current break-all"
              >
                {url}
              </a>
            </p>
          )}
          <button
            type="button"
            onClick={onChangeServer}
            className="w-full border border-border text-ink font-medium py-2.5 rounded-lg hover:bg-canvas transition-colors"
          >
            Use another server
          </button>
        </div>
      </div>
    </div>
  );
}
