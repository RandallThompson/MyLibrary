// Tiny snackbar for "Removed X — Undo" and "Imported N — Undo".
// Single-step only: any new snackbar replaces the previous one.

import { useEffect } from "react";

export default function Snackbar({ snackbar, onAction, onDismiss }) {
  useEffect(() => {
    if (!snackbar) return;
    const t = setTimeout(() => onDismiss && onDismiss(), snackbar.durationMs || 5000);
    return () => clearTimeout(t);
  }, [snackbar, onDismiss]);

  if (!snackbar) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm flex items-center gap-3 spine-shadow">
        <span>{snackbar.message}</span>
        {snackbar.action && (
          <button
            onClick={() => onAction && onAction(snackbar)}
            className="text-[#C77D3F] hover:text-[#F4EBD9] uppercase tracking-wider text-xs font-medium"
          >
            {snackbar.action}
          </button>
        )}
      </div>
    </div>
  );
}
