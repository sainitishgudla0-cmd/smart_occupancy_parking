"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Eases toward a new number. Skipped for people who prefer reduced motion. */
export function useCountUp(target: number | null, duration = 550): number | null {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (target === null) {
      current.current = null;
      // A missing value has nothing to animate.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(null);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = current.current ?? 0;
    if (reduce || from === target) {
      current.current = target;
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}

export function CountUp({ value, format }: { value: number | null; format: (value: number) => string }) {
  const shown = useCountUp(value);
  return <>{shown === null ? "n/a" : format(shown)}</>;
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card fade-in">
      <div className="tile-label">{label}</div>
      <div className={typeof value === "string" ? "tile-value text" : "tile-value"}>{value}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}
