"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { toast } from "sonner";
import type { Document } from "@/lib/api";
import type { AuthAction } from "@/components/AuthPrompt";
import DocumentRow from "@/components/DocumentRow";
import DocumentRowSkeleton from "@/components/DocumentRowSkeleton";
import { CloseIcon, FileTextIcon, SparklesIcon, UploadIcon } from "@/components/icons";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface DocumentSidebarProps {
  documents: Document[];
  loading: boolean;
  uploading: boolean;
  selectedId: string | null;
  error: string | null;
  notice: string | null;
  isOpen: boolean;
  isSignedIn: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpload: (file: File) => void;
  onRequireAuth: (action: AuthAction) => void;
}

export default function DocumentSidebar({
  documents,
  loading,
  uploading,
  selectedId,
  error,
  notice,
  isOpen,
  isSignedIn,
  onClose,
  onSelect,
  onDelete,
  onUpload,
  onRequireAuth,
}: DocumentSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      const mb = (MAX_FILE_SIZE / 1024 / 1024).toFixed(0);
      const message = `File is too large. Please upload a file under ${mb} MB.`;
      setUploadError(message);
      toast.error(message);
      event.target.value = "";
      return;
    }
    setUploadError(null);
    onUpload(file);
    event.target.value = "";
  };

  const handleUploadClick = () => {
    if (!isSignedIn) {
      onRequireAuth("upload");
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-300 md:static md:z-auto md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-indigo-500/20">
              <SparklesIcon className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">PaperChat</p>
              <p className="text-[11px] text-slate-400">Document Q&amp;A</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 md:hidden"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Upload */}
        <div className="px-3 pb-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {uploading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Uploading…
              </>
            ) : (
              <>
                <UploadIcon className="h-4 w-4" />
                Upload document
              </>
            )}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-slate-400">PDF, DOCX or TXT</p>
        </div>

        {(error || notice || uploadError) && (
          <div className="px-3 pb-3">
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </div>
            )}
            {uploadError && !error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {uploadError}
              </div>
            )}
            {notice && !error && !uploadError && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {notice}
              </div>
            )}
          </div>
        )}

        {/* Documents */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Documents
            </span>
            {!loading && documents.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {documents.length}
              </span>
            )}
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {loading ? (
              <ul className="space-y-1">
                {[1, 2, 3, 4].map((i) => (
                  <DocumentRowSkeleton key={i} />
                ))}
              </ul>
            ) : documents.length === 0 ? (
              <div className="mx-2 mt-4 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center">
                <FileTextIcon className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-xs font-medium text-slate-500">No documents yet</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {isSignedIn
                    ? "Upload a file to start chatting."
                    : "Sign in to upload a file and start chatting."}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    active={doc.id === selectedId}
                    onSelect={onSelect}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-3">
          {isSignedIn ? (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
              <UserButton />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-xs font-medium text-slate-700">Signed in</p>
                <p className="truncate text-[11px] text-slate-400">Manage your account</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-700">Guest mode</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                Sign in to upload documents and chat.
              </p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                <Link
                  href="/sign-in?redirect_url=%2Fdashboard"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-center text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up?redirect_url=%2Fdashboard"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Create account
                </Link>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
