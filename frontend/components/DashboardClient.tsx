"use client";

import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Document } from "@/lib/api";
import { streamChat } from "@/lib/chat";
import {
  documentsQueryKey,
  useDeleteDocument,
  useDocuments,
  useUploadDocument,
} from "@/hooks/useDocuments";
import { messagesQueryKey, useMessages } from "@/hooks/useMessages";
import DocumentSidebar from "@/components/DocumentSidebar";
import ChatPanel from "@/components/ChatPanel";
import AuthPrompt from "@/components/AuthPrompt";
import type { AuthAction } from "@/components/AuthPrompt";
import { SparklesIcon } from "@/components/icons";

interface DashboardClientProps {
  initialDocId: string | null;
}

export default function DashboardClient({ initialDocId }: DashboardClientProps) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const documentsQuery = useDocuments();
  const { mutate: uploadFile, isPending: uploading } = useUploadDocument();
  const { mutate: removeDocument } = useDeleteDocument();

  const documents = documentsQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(initialDocId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthAction | null>(null);

  const requireAuth = useCallback((action: AuthAction) => {
    setAuthPrompt(action);
  }, []);

  // Close the auth prompt automatically once the user is authenticated.
  useEffect(() => {
    if (isSignedIn) setAuthPrompt(null);
  }, [isSignedIn]);

  // Drop the previous user's cached documents and conversations on sign-out so
  // a guest session never sees them.
  const wasSignedIn = useRef<boolean>(!!isSignedIn);
  useEffect(() => {
    if (wasSignedIn.current && !isSignedIn) {
      queryClient.removeQueries({ queryKey: documentsQueryKey });
      queryClient.removeQueries({ queryKey: ["messages"] });
      setSelectedId(null);
    }
    wasSignedIn.current = !!isSignedIn;
  }, [isSignedIn, queryClient]);

  const selectedIdRef = useRef<string | null>(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedId) ?? null,
    [documents, selectedId]
  );
  const selectedDocId = selectedDoc?.id ?? null;
  const isReady = selectedDoc?.status === "ready";

  const messagesQuery = useMessages(selectedDocId, isReady);
  const messages = messagesQuery.data ?? [];
  const messagesLoading = messagesQuery.isLoading;

  // Auto-select the first available document when none is selected.
  useEffect(() => {
    if (documentsQuery.isLoading || selectedId || documents.length === 0) return;
    const firstReady = documents.find((doc) => doc.status === "ready") ?? documents[0];
    setSelectedId(firstReady.id);
  }, [documentsQuery.isLoading, documents, selectedId]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setSidebarOpen(false);
  }, []);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!isSignedIn) {
        requireAuth("chat");
        return;
      }

      const doc = selectedDoc;
      const trimmed = question.trim();
      if (!doc || doc.status !== "ready" || !trimmed || streaming) return;

      const cacheKey = messagesQueryKey(doc.id);
      setChatError(null);
      queryClient.setQueryData<ChatMessage[]>(cacheKey, (prev = []) => [
        ...prev,
        { role: "user", content: trimmed, sources: [] },
      ]);
      setStreaming(true);

      try {
        const token = await getToken();
        await streamChat({
          documentId: doc.id,
          question: trimmed,
          token,
          onUpdate: (content, sources) => {
            // Ignore late chunks if the user switched documents mid-stream.
            if (selectedIdRef.current !== doc.id) return;
            queryClient.setQueryData<ChatMessage[]>(cacheKey, (prev = []) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                const copy = [...prev];
                copy[copy.length - 1] = { ...last, content, sources };
                return copy;
              }
              return [...prev, { role: "assistant", content, sources }];
            });
          },
        });
      } catch (err) {
        if (selectedIdRef.current === doc.id) {
          setChatError({
            message: err instanceof Error ? err.message : "Chat failed",
            retryable: true,
          });
        }
      } finally {
        setStreaming(false);
      }
    },
    [isSignedIn, requireAuth, selectedDoc, streaming, getToken, queryClient]
  );

  const handleRetry = useCallback(() => {
    if (!selectedDoc) return;
    const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;

    const lastUserContent = messages[lastUserIndex].content;
    const cacheKey = messagesQueryKey(selectedDoc.id);
    // Drop the previous answer and the user turn — sendMessage re-adds the user turn.
    queryClient.setQueryData<ChatMessage[]>(cacheKey, (prev = []) =>
      prev.slice(0, lastUserIndex)
    );
    setChatError(null);
    void sendMessage(lastUserContent);
  }, [messages, selectedDoc, queryClient, sendMessage]);

  const handleUpload = useCallback(
    (file: File) => {
      if (!isSignedIn) {
        requireAuth("upload");
        return;
      }
      setActionError(null);
      setNotice(null);
      uploadFile(file, {
        onSuccess: (result, uploadedFile) => {
          // Optimistically insert the new document so the UI responds instantly.
          queryClient.setQueryData<Document[]>(documentsQueryKey, (prev = []) => {
            if (prev.some((doc) => doc.id === result.id)) return prev;
            const now = new Date().toISOString();
            return [
              {
                id: result.id,
                original_name: uploadedFile.name,
                file_size: uploadedFile.size,
                status: "processing",
                error_message: null,
                page_count: 0,
                created_at: now,
                updated_at: now,
              },
              ...prev,
            ];
          });
          setSelectedId(result.id);
          setSidebarOpen(false);
          showNotice("Uploaded — processing started");
        },
        onError: (err) =>
          setActionError(err instanceof Error ? err.message : "Upload failed"),
      });
    },
    [isSignedIn, requireAuth, uploadFile, queryClient, showNotice]
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm("Delete this document?")) return;
      setActionError(null);
      setNotice(null);
      removeDocument(id, {
        onSuccess: () => {
          setSelectedId((prev) => (prev === id ? null : prev));
          showNotice("Document deleted");
        },
        onError: (err) =>
          setActionError(err instanceof Error ? err.message : "Delete failed"),
      });
    },
    [removeDocument, showNotice]
  );

  const docErrorMessage =
    actionError ??
    (documentsQuery.isError ? (documentsQuery.error as Error).message : null);
  const messagesErrorMessage = messagesQuery.isError
    ? { message: (messagesQuery.error as Error).message, retryable: false }
    : null;
  const combinedChatError = chatError ?? messagesErrorMessage;

  if (!isLoaded) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
            <SparklesIcon className="h-7 w-7" />
          </div>
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-50">
      <DocumentSidebar
        documents={documents}
        loading={documentsQuery.isLoading}
        uploading={uploading}
        selectedId={selectedId}
        error={docErrorMessage}
        notice={notice}
        isOpen={sidebarOpen}
        isSignedIn={!!isSignedIn}
        onClose={() => setSidebarOpen(false)}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onUpload={handleUpload}
        onRequireAuth={requireAuth}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatPanel
          document={selectedDoc}
          messages={messages}
          messagesLoading={messagesLoading}
          streaming={streaming}
          error={combinedChatError}
          isSignedIn={!!isSignedIn}
          onSend={sendMessage}
          onRetry={handleRetry}
          onOpenSidebar={() => setSidebarOpen(true)}
          onRequireAuth={requireAuth}
        />
      </div>

      {authPrompt && !isSignedIn && (
        <AuthPrompt action={authPrompt} onClose={() => setAuthPrompt(null)} />
      )}
    </div>
  );
}
