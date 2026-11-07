/**
 * Isolation tests: verifies that user B cannot access user A's documents.
 * 
 * These tests require two Clerk accounts (userA and userB) and a running backend.
 * Run with: npx tsx tests/isolation.test.ts
 */

const API_URL = process.env.API_URL || "http://localhost:8000";

interface TestUser {
  userId: string;
  token: string;
}

async function requestWithToken(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function run() {
  const userA: TestUser = {
    userId: process.env.USER_A_ID || "",
    token: process.env.USER_A_TOKEN || "",
  };
  const userB: TestUser = {
    userId: process.env.USER_B_ID || "",
    token: process.env.USER_B_TOKEN || "",
  };

  if (!userA.userId || !userA.token || !userB.userId || !userB.token) {
    console.error("Missing USER_A_ID, USER_A_TOKEN, USER_B_ID, USER_B_TOKEN env vars");
    console.log("Set them from two Clerk accounts, then re-run.");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.log(`  FAIL: ${message}`);
      failed++;
    }
  }

  // Step 1: Create a document as user A
  console.log("\n1. Creating a document as user A...");
  const createRes = await requestWithToken("POST", "/api/documents", userA.token, {
    original_name: "isolation-test.pdf",
    file_size: 1024,
    status: "ready",
  });
  assert(createRes.status === 200 || createRes.status === 201, "User A can create a document");
  const docData = await createRes.json();
  const docId = docData.id;
  console.log(`   Document ID: ${docId}`);

  // Step 2: User A can access their own document
  console.log("\n2. User A accesses their own document...");
  const getOwnRes = await requestWithToken("GET", `/api/documents/${docId}`, userA.token);
  assert(getOwnRes.status === 200, "User A can GET their own document");

  // Step 3: User B gets 404 on user A's document
  console.log("\n3. User B attempts to access user A's document...");
  const getOthersRes = await requestWithToken("GET", `/api/documents/${docId}`, userB.token);
  assert(getOthersRes.status === 404, "User B gets 404 on user A's document");

  // Step 4: User B's document list is empty (doesn't see user A's doc)
  console.log("\n4. User B lists their documents...");
  const listBRes = await requestWithToken("GET", "/api/documents", userB.token);
  const listBData = await listBRes.json();
  assert(listBRes.status === 200, "User B can list their own documents");
  assert(
    !listBData.documents?.some((d: any) => d.id === docId),
    "User B's document list does not contain user A's document"
  );

  // Step 5: User B cannot delete user A's document
  console.log("\n5. User B attempts to delete user A's document...");
  const deleteRes = await requestWithToken("DELETE", `/api/documents/${docId}`, userB.token);
  assert(deleteRes.status === 404, "User B gets 404 when deleting user A's document");

  // Step 6: User B cannot chat against user A's document
  console.log("\n6. User B attempts to chat against user A's document...");
  const chatRes = await requestWithToken("POST", "/api/chat", userB.token, {
    document_id: docId,
    question: "What is this document about?",
  });
  assert(chatRes.status === 404, "User B gets 404 when chatting against user A's document");

  // Step 7: User B cannot fetch messages for user A's document
  console.log("\n7. User B attempts to fetch messages for user A's document...");
  const messagesRes = await requestWithToken("GET", `/api/messages/${docId}`, userB.token);
  assert(messagesRes.status === 404, "User B gets 404 fetching messages for user A's document");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});