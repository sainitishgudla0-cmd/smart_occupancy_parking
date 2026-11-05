"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Filters live in the URL, so a view can be bookmarked or shared and survives a refresh. */
export function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const setFilters = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const text = next.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { get: (key: string) => params.get(key), setFilters };
}
