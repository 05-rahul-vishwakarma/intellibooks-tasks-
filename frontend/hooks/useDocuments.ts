"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDocument, fetchDocuments, uploadDocument } from "@/lib/api";
import type { Document } from "@/lib/api";

export const documentsQueryKey = ["documents"] as const;

/**
 * Fetches the document list once and caches it.
 * While any document is still processing, it polls every 3s; otherwise it stops.
 */
export function useDocuments() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: documentsQueryKey,
    queryFn: async () => {
      const token = await getToken();
      return fetchDocuments(token ?? "");
    },
    enabled: !!isSignedIn,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const documents = query.state.data as Document[] | undefined;
      return documents?.some((doc) => doc.status === "processing") ? 3000 : false;
    },
  });
}

export function useUploadDocument() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", file);
      return uploadDocument(token ?? "", formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useDeleteDocument() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await deleteDocument(token ?? "", id);
      return id;
    },
    onSuccess: (_deletedId, id) => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
      // Drop the deleted document's cached conversation.
      queryClient.removeQueries({ queryKey: ["messages", id] });
    },
  });
}
