"use client";

import { useCallback, useEffect, useState } from "react";

const cache = new Map<string, unknown>();

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let detail = `The API returned status ${response.status}.`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  /** True while a request is in flight. Earlier data stays available so charts hold their frame. */
  loading: boolean;
  retry: () => void;
}

export function useApi<T>(url: string | null): ApiState<T> {
  const [latest, setLatest] = useState<T | null>(null);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!url || cache.has(url)) return;
    const controller = new AbortController();
    fetchJson<T>(url, controller.signal)
      .then((body) => {
        cache.set(url, body);
        setLatest(body);
        setFailure(null);
      })
      .catch((reason: Error) => {
        if (controller.signal.aborted) return;
        setFailure({ url, message: reason.message || "The request failed." });
      });
    return () => controller.abort();
  }, [url, attempt]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  const cached = url && cache.has(url) ? (cache.get(url) as T) : null;
  const error = failure && failure.url === url ? failure.message : null;
  return {
    // While a new request runs, the previous result stays on screen.
    data: cached ?? latest,
    error,
    loading: url !== null && cached === null && error === null,
    retry,
  };
}

export function query(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
