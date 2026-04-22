"use client";

import { useEffect, useSyncExternalStore } from "react";

type PendingEntry = {
  pendingUsd: number;
  /** Server `snapshot.volumeUsd` when this pending chain started (first delta). */
  anchorUsd: number;
};

const pendingBySlug: Record<string, PendingEntry> = {};

/** Latest server volume seen while no pending (per slug); seeds anchor when optional baseline omitted. */
const lastIdleServerVolumeBySlug: Record<string, number> = {};

let storeVersion = 0;

function bumpStore() {
  storeVersion += 1;
  for (const l of listeners) {
    l();
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPendingForSlug(slug: string): number {
  return pendingBySlug[slug]?.pendingUsd ?? 0;
}

function syncIdleSnapshot(slug: string, serverVolumeUsd: number) {
  if (getPendingForSlug(slug) <= 0) {
    lastIdleServerVolumeBySlug[slug] = serverVolumeUsd;
  }
}

/**
 * Clears pending when server volume has caught up to anchor + pending (with small tolerance).
 */
function tryClearPendingForServerVolume(slug: string, serverVolumeUsd: number) {
  const e = pendingBySlug[slug];
  if (!e || e.pendingUsd <= 0) return;

  if (!Number.isFinite(serverVolumeUsd)) return;

  const expected = e.anchorUsd + e.pendingUsd;
  const tol = Math.max(0.05, e.pendingUsd * 0.05);
  const caughtUp = serverVolumeUsd + 1e-9 >= expected - tol;

  if (caughtUp) {
    delete pendingBySlug[slug];
    lastIdleServerVolumeBySlug[slug] = serverVolumeUsd;
    console.info("[predicted][volume-optimistic] optimistic_delta_cleared", {
      slug,
      serverVolumeUsd,
      hadPendingUsd: e.pendingUsd,
      anchorUsd: e.anchorUsd,
    });
    bumpStore();
  }
}

/**
 * Temporary client-only overlay for `markets.last_known_volume_usd` (per market slug / `market.id`).
 */
export function addPendingDelta(
  slug: string,
  deltaUsd: number,
  serverBaselineVolumeUsd?: number,
) {
  if (!Number.isFinite(deltaUsd) || deltaUsd <= 0) return;

  const fromProp =
    typeof serverBaselineVolumeUsd === "number" &&
    Number.isFinite(serverBaselineVolumeUsd)
      ? Math.max(0, serverBaselineVolumeUsd)
      : undefined;

  const baseline =
    fromProp ??
    lastIdleServerVolumeBySlug[slug] ??
    pendingBySlug[slug]?.anchorUsd ??
    0;

  const prev = pendingBySlug[slug];
  if (!prev || prev.pendingUsd <= 0) {
    pendingBySlug[slug] = { pendingUsd: deltaUsd, anchorUsd: baseline };
  } else {
    pendingBySlug[slug] = {
      pendingUsd: prev.pendingUsd + deltaUsd,
      anchorUsd: prev.anchorUsd,
    };
  }

  console.info("[predicted][volume-optimistic] optimistic_delta_added", {
    slug,
    deltaUsd,
    baselineUsd: pendingBySlug[slug]!.anchorUsd,
    pendingTotalUsd: pendingBySlug[slug]!.pendingUsd,
  });
  bumpStore();
}

export function clearPendingDelta(slug: string) {
  if (!pendingBySlug[slug]) return;
  delete pendingBySlug[slug];
  console.info("[predicted][volume-optimistic] optimistic_delta_cleared", {
    slug,
    reason: "manual_clear",
  });
  bumpStore();
}

export function getPendingDelta(slug: string): number {
  return getPendingForSlug(slug);
}

/**
 * Subscribe to pending USD overlay for a slug; keeps idle server snapshot updated and clears when server catches up.
 */
export function usePendingVolumeDelta(
  slug: string,
  serverVolumeUsd: number,
  lastStatsUpdatedAt?: string | null,
): number {
  const pending = useSyncExternalStore(
    subscribe,
    () => {
      void storeVersion;
      return getPendingForSlug(slug);
    },
    () => 0,
  );

  useEffect(() => {
    const server = Number.isFinite(serverVolumeUsd)
      ? Math.max(0, serverVolumeUsd)
      : 0;
    syncIdleSnapshot(slug, server);
    tryClearPendingForServerVolume(slug, server);
  }, [slug, serverVolumeUsd, lastStatsUpdatedAt]);

  return pending;
}
