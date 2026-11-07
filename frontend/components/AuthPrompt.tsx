"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CloseIcon, SparklesIcon } from "@/components/icons";

export type AuthAction = "upload" | "chat";

interface AuthPromptProps {
  action: AuthAction;
  onClose: () => void;
}

const actionCopy: Record<AuthAction, { title: string; body: string }> = {
  upload: {
    title: "Sign in to upload documents",
    body: "Create a free account or sign in to upload PDFs, DOCX, and TXT files and build your document library.",
  },
  chat: {
    title: "Sign in to chat",
    body: "Create a free account or sign in to ask questions about your documents and get answers with page citations.",
  },
};

/**
 * Modal shown to guests when they try to upload a document or send a message.
 * The app shell stays public; only these actions require an account.
 */
export default function AuthPrompt({ action, onClose }: AuthPromptProps) {
  const copy = actionCopy[action];

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const redirect = encodeURIComponent("/dashboard");
  const signInHref = `/sign-in?redirect_url=${redirect}`;
  const signUpHref = `/sign-up?redirect_url=${redirect}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-prompt-title"
    >
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <CloseIcon className="h-5 w-5" />
        </button>

        <div className="px-6 pb-6 pt-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
            <SparklesIcon className="h-7 w-7" />
          </div>

          <h2 id="auth-prompt-title" className="text-xl font-semibold text-slate-900">
            {copy.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{copy.body}</p>

          <div className="mt-6 flex flex-col gap-2.5">
            <Link
              href={signInHref}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
              Sign in
            </Link>
            <Link
              href={signUpHref}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
              Create free account
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 rounded-xl px-4 py-2 text-xs font-medium text-slate-500 transition hover:text-slate-700"
            >
              Continue browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
