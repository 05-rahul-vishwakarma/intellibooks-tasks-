"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import type { ChatMessage, ChatSource } from "@/lib/api";

interface RawMessage {
  role?: string;
  content?: unknown;
  sources?: unknown;
}

export function messagesQueryKey(documentId: string | null) {
  return ["messages", documentId] as const;
}

/**
 * Loads a document's chat history and caches it per document id.
 * The cache is also the source of truth for live streaming updates
 * (see DashboardClient), so switching documents is instant.
 */
export function useMessages(documentId: string | null, enabled: boolean) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: messagesQueryKey(documentId),
    queryFn: async (): Promise<ChatMessage[]> => {
      const token = await getToken();
      const res = await apiRequest(`/api/messages/${documentId}`, undefined, token);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      const raw: RawMessage[] = Array.isArray(data.messages) ? data.messages : [];
      return raw.map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: String(message.content ?? ""),
        sources: Array.isArray(message.sources) ? (message.sources as ChatSource[]) : [],
      }));
    },
    enabled: !!documentId && enabled,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
