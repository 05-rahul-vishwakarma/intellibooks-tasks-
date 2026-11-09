export const runtime = "nodejs";

import { Toaster } from "sonner";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Providers from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperChat",
  description: "RAG document Q&A with pgvector and Clerk",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <Providers>{children}</Providers>
          <Toaster position="top-right" richColors />
        </body>
      </html>
    </ClerkProvider>
  );
}