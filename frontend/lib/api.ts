export interface Document {
  id: string;
  original_name: string;
  file_size: number;
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  page_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSource {
  page_number: number;
  content: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
  token?: string
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const url = typeof input === "string" ? input : input.toString();
  const base = API_URL.replace(/\/+$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return fetch(`${base}${path}`, {
    ...init,
    headers,
  });
}

export async function fetchDocuments(token: string): Promise<Document[]> {
  const res = await apiRequest("/api/documents", undefined, token);
  if (!res.ok) throw new Error("Failed to load documents");
  const data = await res.json();
  return data.documents || [];
}

export async function deleteDocument(token: string, id: string): Promise<void> {
  const res = await apiRequest(`/api/documents/${id}`, { method: "DELETE" }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("Unauthorized — please sign in again");
    if (res.status === 404) throw new Error("Document not found");
    if (res.status === 500) throw new Error("Server error — try again later");
    throw new Error(err.error || "Failed to delete document");
  }
}

export async function uploadDocument(
  token: string,
  formData: FormData
): Promise<{ id: string; status: string }> {
  const res = await apiRequest("/api/documents", {
    method: "POST",
    body: formData,
  }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}