"use client";

import type { ReactNode } from "react";

export function Skeleton({ height = 160 }: { height?: number }) {
  return (
    <div role="status" className="skeleton" style={{ minHeight: height }}>
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <h3>This section could not load</h3>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
