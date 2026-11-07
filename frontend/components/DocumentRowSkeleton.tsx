"use client";

import { SkeletonLoader } from "@/components/SkeletonLoader";

/**
 * Skeleton placeholder for a sidebar DocumentRow.
 * Mirrors the compact row layout so the list doesn't shift while loading.
 */
export default function DocumentRowSkeleton() {
  return (
    <li className="flex items-start gap-2.5 rounded-xl px-2.5 py-2.5">
      <SkeletonLoader width="1rem" height="1rem" radius="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonLoader width="80%" height="0.875rem" radius="sm" />
        <SkeletonLoader width="55%" height="0.625rem" radius="sm" />
      </div>
    </li>
  );
}
