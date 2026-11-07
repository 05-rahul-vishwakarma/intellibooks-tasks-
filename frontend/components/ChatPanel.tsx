"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSource, Document } from "@/lib/api";
import MessageBubble from "@/components/MessageBubble";
import { ChatMessageSkeleton } from "@/components/ChatMessageSkeleton";
import {
  AlertTriangleIcon,
  CloseIcon,
  FileTextIcon,
  MenuIcon,
  SendIcon,
  SparklesIcon,
} from "@/components/icons";

interface ChatPanelProps {
  document: Document | null;
  messages: ChatMessage[];
  messagesLoading: boolean;
  streaming: boolean;
  error: { message: string; retryable: boolean } | null;
  onSend: (question: string) => void;
  onRetry: () => void;
  onOpenSidebar: () => void;
}

const statusStyles: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  processing: "bg-amber-50 text-amber-700 ring-amber-600/20",
  failed: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export default function ChatPanel({
  document,
  messages,
  messagesLoading,
  streaming,
  error,
  onSend,
  onRetry,
  onOpenSidebar,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [activeSource, setActiveSource] = useState<ChatSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const isReady = document?.status === "ready";
  const canSend = input.trim().length > 0 && !streaming && !messagesLoading;
  const showConversation = messages.length > 0 || messagesLoading || streaming || !!error;

  // Reset the composer when switching documents.
  useEffect(() => {
    setInput("");
  }, [document?.id]);

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Keep the latest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: streaming ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, streaming, messagesLoading]);

  // Close the source dialog with Escape.
  useEffect(() => {
    if (!activeSource) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveSource(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeSource]);

  const submit = () => {
    if (!canSend) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open documents"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 md:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        {document ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 sm:flex">
              <FileTextIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {document.original_name}
              </p>
              <p className="text-[11px] text-slate-400">{document.page_count} pages</p>
            </div>
          </div>
        ) : (
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">PaperChat</p>
            <p className="text-[11px] text-slate-400">Document Q&amp;A</p>
          </div>
        )}

        {document && (
          <span
            className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${
              statusStyles[document.status] ?? "bg-slate-100 text-slate-600 ring-slate-500/20"
            }`}
          >
            {document.status}
          </span>
        )}
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!document ? (
          <WelcomePanel onOpenSidebar={onOpenSidebar} />
        ) : document.status === "processing" ? (
          <ProcessingPanel document={document} />
        ) : document.status === "failed" ? (
          <FailedPanel document={document} />
        ) : showConversation ? (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
              {error && (
                <ErrorBanner error={error} onRetry={onRetry} />
              )}

              {messagesLoading && messages.length === 0 && (
                <>
                  <ChatMessageSkeleton role="assistant" />
                  <ChatMessageSkeleton role="assistant" />
                </>
              )}

              {messages.map((message, index) => (
                <MessageBubble
                  key={index}
                  role={message.role}
                  content={message.content}
                  sources={message.sources}
                  onSourceClick={setActiveSource}
                />
              ))}

              {streaming && <ChatMessageSkeleton role="assistant" />}

              <div ref={endRef} />
            </div>
          </div>
        ) : (
          <EmptyChat document={document} />
        )}
      </div>

      {/* Composer */}
      {isReady && (
        <div className="border-t border-slate-200 bg-white px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mx-auto w-full max-w-3xl"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm transition focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-500/10">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about this document…"
                disabled={streaming || messagesLoading}
                className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              PaperChat can make mistakes. Check the cited source passages.
            </p>
          </form>
        </div>
      )}

      {/* Source dialog */}
      {activeSource && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Source passage"
        >
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setActiveSource(null)}
          />
          <div className="relative flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Source passage</h2>
                <p className="text-xs text-slate-400">
                  {activeSource.page_number > 0
                    ? `Page ${activeSource.page_number}`
                    : "Document excerpt"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSource(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="scrollbar-thin overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                {activeSource.content}
              </p>
            </div>
            <div className="border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setActiveSource(null)}
                className="w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorBanner({
  error,
  onRetry,
}: {
  error: { message: string; retryable: boolean };
  onRetry: () => void;
}) {
  const rateLimited = error.message.toLowerCase().includes("rate limited");
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
        rateLimited
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p>{error.message}</p>
        {error.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function WelcomePanel({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const features = [
    { title: "Upload", desc: "PDF, DOCX, TXT" },
    { title: "Chat", desc: "Ask anything" },
    { title: "Cite", desc: "See sources" },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
        <SparklesIcon className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        Ask your documents anything
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        Pick a document from the sidebar to start chatting, or upload a new PDF, DOCX, or TXT file.
        Every answer comes with the source passages it used.
      </p>

      <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-800">{feature.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{feature.desc}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenSidebar}
        className="mt-6 text-xs font-medium text-indigo-600 hover:text-indigo-700 md:hidden"
      >
        Open documents
      </button>
    </div>
  );
}

function EmptyChat({ document }: { document: Document }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        <SparklesIcon className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">Start the conversation</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Ask a question about{" "}
        <span className="font-medium text-slate-700">{document.original_name}</span>. Answers are
        grounded in the document with page citations.
      </p>
    </div>
  );
}

function ProcessingPanel({ document }: { document: Document }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-indigo-600" />
      <h2 className="mt-4 text-lg font-semibold text-slate-900">Processing your document</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        We&apos;re extracting and indexing{" "}
        <span className="font-medium text-slate-700">{document.original_name}</span>. This page
        updates automatically when it&apos;s ready.
      </p>
    </div>
  );
}

function FailedPanel({ document }: { document: Document }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertTriangleIcon className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">Couldn&apos;t process this document</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        {document.error_message ||
          "Something went wrong while indexing this file. Try deleting it and uploading again."}
      </p>
    </div>
  );
}
