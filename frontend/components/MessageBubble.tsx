"use client";

import { useMemo } from "react";
import type { ChatSource } from "@/lib/api";
import { groupSourcesByPage } from "@/lib/sources";
import { SparklesIcon } from "@/components/icons";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  onSourceClick?: (source: ChatSource) => void;
}

export default function MessageBubble({
  role,
  content,
  sources = [],
  onSourceClick,
}: MessageBubbleProps) {
  const groupedSources = useMemo(() => groupSourcesByPage(sources), [sources]);

  if (role === "user") {
    return (
      <div className="flex animate-fade-in-up justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-indigo-600 px-4 py-3 text-[15px] leading-relaxed text-white shadow-sm">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex animate-fade-in-up items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
        <SparklesIcon className="h-4 w-4" />
      </div>

      <div className="min-w-0 max-w-[85%]">
        {groupedSources.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {groupedSources.map((source) => (
              <button
                key={source.page_number}
                type="button"
                onClick={() => onSourceClick?.(source)}
                title={
                  source.count > 1
                    ? `${source.count} passages from this page`
                    : "View source passage"
                }
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                {source.page_number > 0 ? `Page ${source.page_number}` : "Source"}
              </button>
            ))}
          </div>
        )}

        <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-800 shadow-sm">
          {content}
        </div>
      </div>
    </div>
  );
}
