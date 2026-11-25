import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-5xl font-semibold text-slate-300">404</p>
      <p className="mt-2 text-slate-600">This page doesn't exist.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">Go to dashboard</Link>
    </div>
  );
}
