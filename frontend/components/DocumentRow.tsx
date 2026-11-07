"use client";

import type { Document } from "@/lib/api";
import { FileTextIcon, TrashIcon } from "@/components/icons";

interface DocumentRowProps {
  doc: Document;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const statusStyles: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  processing: "bg-amber-50 text-amber-700 ring-amber-600/20",
  failed: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

function formatUploadDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function DocumentRow({ doc, active, onSelect, onDelete }: DocumentRowProps) {
  const badge = statusStyles[doc.status] ?? "bg-slate-100 text-slate-600 ring-slate-500/20";
  const uploaded = formatUploadDate(doc.created_at);

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onSelect(doc.id)}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-start gap-2.5 rounded-xl py-2.5 pl-2.5 pr-8 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
          active ? "bg-indigo-50 ring-1 ring-indigo-100" : "hover:bg-slate-100"
        }`}
      >
        <FileTextIcon
          className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm font-medium ${
              active ? "text-indigo-900" : "text-slate-700"
            }`}
          >
            {doc.original_name}
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset ${badge}`}
            >
              {doc.status}
            </span>
            <span className="truncate text-[11px] text-slate-400">
              {doc.page_count} pg · {(doc.file_size / 1024).toFixed(0)} KB
              {uploaded ? ` · ${uploaded}` : ""}
            </span>
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onDelete(doc.id)}
        aria-label={`Delete ${doc.original_name}`}
        title="Delete document"
        className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 group-hover:opacity-100"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
