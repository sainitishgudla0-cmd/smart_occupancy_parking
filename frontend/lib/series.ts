import type { ModelKey } from "./types";

/** Each model keeps one color everywhere in the app, whichever models are on screen. */
export const MODEL_COLORS: Record<ModelKey, string> = {
  knn: "var(--series-1)",
  svr: "var(--series-2)",
  boosting: "var(--series-3)",
};

export const MODEL_SHORT: Record<ModelKey, string> = {
  knn: "KNN",
  svr: "SVR",
  boosting: "Boosting",
};

export const CLUSTER_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

export function clusterColor(id: number | null | undefined): string {
  return id === null || id === undefined ? "var(--ink-3)" : CLUSTER_COLORS[id % CLUSTER_COLORS.length];
}
