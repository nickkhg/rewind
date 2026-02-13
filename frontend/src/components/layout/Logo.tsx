import { Link } from "react-router-dom";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`font-display font-semibold tracking-tight hover:opacity-80 transition-opacity ${className}`}>
      Rewind
    </Link>
  );
}
