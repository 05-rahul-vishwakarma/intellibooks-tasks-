"use client";

import { SkeletonLoader } from "@/components/SkeletonLoader";

interface ChatMessageSkeletonProps {
  role?: "user" | "assistant";
}

export function ChatMessageSkeleton({ role = "assistant" }: ChatMessageSkeletonProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="w-2/3 max-w-[85%] space-y-2 rounded-2xl rounded-tr-md bg-slate-200/70 px-4 py-3">
          <SkeletonLoader width="90%" height="0.75rem" />
          <SkeletonLoader width="60%" height="0.75rem" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <SkeletonLoader width="2rem" height="2rem" radius="full" className="mt-0.5 shrink-0" />
      <div className="w-full max-w-[80%] space-y-2">
        <SkeletonLoader width="5rem" height="1.25rem" radius="full" />
        <div className="space-y-2 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <SkeletonLoader width="85%" height="0.75rem" />
          <SkeletonLoader width="95%" height="0.75rem" />
          <SkeletonLoader width="70%" height="0.75rem" />
        </div>
      </div>
    </div>
  );
}
