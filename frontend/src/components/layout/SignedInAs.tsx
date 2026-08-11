import { useAuth } from "../../hooks/useAuth";
import { signOutUrl } from "../../lib/auth";

/**
 * Who you are signed in as, and the way out.
 *
 * It draws nothing at all on a server that asks nobody to sign in, so the home page and the board
 * header of an open deployment look exactly as they did. Small and quiet: on a board this is the
 * least of what the header carries, and it should not read as one of the controls.
 */
export function SignedInAs({ className = "" }: { className?: string }) {
  const auth = useAuth();
  if (!auth?.enabled || !auth.user) return null;

  return (
    <span
      className={`flex items-center gap-2 text-xs text-muted min-w-0 ${className}`}
    >
      <span className="truncate" title={auth.user.email ?? auth.user.name}>
        {auth.user.name}
      </span>
      <a
        href={signOutUrl()}
        className="shrink-0 underline decoration-border hover:decoration-current hover:text-ink transition-colors"
      >
        Sign out
      </a>
    </span>
  );
}
