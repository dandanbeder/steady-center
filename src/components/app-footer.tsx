import { Link } from "@tanstack/react-router";

export function AppFooter({ className = "" }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={
        "border-t border-border py-3 px-4 sm:px-8 text-xs text-muted-foreground safe-bottom " +
        "flex flex-col sm:flex-row items-center justify-center gap-x-4 gap-y-1 text-center " +
        className
      }
    >
      <span>© {year} FlightMed (PTY) Ltd. All rights reserved.</span>
      <span className="hidden sm:inline opacity-50">·</span>
      <span className="inline-flex items-center gap-4">
        <Link to="/terms" className="hover:text-foreground transition-colors">
          Terms
        </Link>
        <Link to="/privacy" className="hover:text-foreground transition-colors">
          Privacy
        </Link>
      </span>
    </footer>
  );
}
