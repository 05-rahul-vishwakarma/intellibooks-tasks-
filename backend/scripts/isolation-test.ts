import "../src/env";
import { prisma } from "../src/lib/db";

/**
 * Two-user isolation test.
 *
 * Creates a document owned by user A directly in the database (so the test does
 * not depend on Cloudinary/Gemini being available or on upload latency), then
 * calls the real API with user B's Clerk session token and asserts that every
 * route denies access to A's document.
 *
 * Prerequisites:
 *   1. The backend is running and shares DATABASE_URL with this script.
 *   2. Two Clerk users. Grab their session tokens from the browser
 *      (Application → Cookies → __session) or via Clerk's testing helpers.
 *
 * Run:
 *   cd backend
 *   USER_A_ID=user_xxx USER_A_TOKEN=eyJ... \
 *   USER_B_TOKEN=eyJ... npm run test:isolation
 */

const API_URL = process.env.API_URL || "http://localhost:8000";

interface Identity {
  label: string;
  token: string;
  userId?: string;
}

function identity(label: string, prefix: string): Identity | null {
  const token = process.env[`${prefix}_TOKEN`];
  if (!token) return null;
  return { label, token, userId: process.env[`${prefix}_ID`] };
}

async function request(method: string, path: string, token: string, body?: unknown) {
  return fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  const userA = identity("A", "USER_A");
  const userB = identity("B", "USER_B");

  if (!userA || !userB || !userA.userId) {
    console.error(
      "Missing env vars. Required: USER_A_ID, USER_A_TOKEN, USER_B_TOKEN.\n" +
        "USER_A_ID must be the Clerk user id that owns the test document."
    );
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const check = (ok: boolean, message: string) => {
    console.log(`  ${ok ? "PASS" : "FAIL"}: ${message}`);
    ok ? passed++ : failed++;
  };

  const document = await prisma.document.create({
    data: {
      userId: userA.userId,
      originalName: "isolation-test.txt",
      fileSize: 32,
      status: "ready",
    },
  });
  console.log(`\nCreated document ${document.id} owned by user A (${userA.userId}).`);

  try {
    console.log("\n1. Each user's document list is scoped to them");
    const listA = await request("GET", "/api/documents", userA.token);
    const listB = await request("GET", "/api/documents", userB.token);
    const dataA = (await listA.json()) as { documents?: { id: string }[] };
    const dataB = (await listB.json()) as { documents?: { id: string }[] };
    check(listA.status === 200, "User A can list documents");
    check(
      !!dataA.documents?.some((d) => d.id === document.id),
      "User A sees their own document"
    );
    check(
      !dataB.documents?.some((d) => d.id === document.id),
      "User B does not see User A's document"
    );

    console.log("\n2. Reading another user's document by id is denied");
    const getA = await request("GET", `/api/documents/${document.id}`, userA.token);
    const getB = await request("GET", `/api/documents/${document.id}`, userB.token);
    check(getA.status === 200, "User A can GET their own document");
    check(getB.status === 404, "User B gets 404 on User A's document");

    console.log("\n3. Chat against another user's document is denied");
    const chatB = await request("POST", "/api/chat", userB.token, {
      document_id: document.id,
      question: "What is this document about?",
    });
    check(chatB.status === 404, "User B gets 404 when chatting against User A's document");

    console.log("\n4. Reading another user's chat history is denied");
    const msgB = await request("GET", `/api/messages/${document.id}`, userB.token);
    check(msgB.status === 404, "User B gets 404 for User A's chat history");

    console.log("\n5. Deleting another user's document is denied");
    const delB = await request("DELETE", `/api/documents/${document.id}`, userB.token);
    check(delB.status === 404, "User B gets 404 when deleting User A's document");

    // Make sure B's failed delete did not remove A's document.
    const stillThere = await request("GET", `/api/documents/${document.id}`, userA.token);
    check(stillThere.status === 200, "User A's document still exists after B's delete attempt");
  } finally {
    await prisma.document.delete({ where: { id: document.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Test runner error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
