import "../src/env";

/**
 * Provider smoke test: verifies the Gemini embedding key/model and the Groq
 * chat key/model are configured and reachable.
 *
 * Run: npm run smoke-test
 */
async function main() {
  const missing = ["GEMINI_API_KEY", "GROQ_API_KEY"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const { embedText } = await import("../src/lib/embeddings");
  const { groqChat, GROQ_MODEL } = await import("../src/lib/groq");

  // 1. Embeddings (Gemini)
  const vector = await embedText("smoke test chunk");
  console.log(`Embedding model: ${process.env.EMBEDDING_MODEL || "gemini-embedding-001"}`);
  console.log(`Embedding dimensions: ${vector.length}`);

  // 2. Chat (Groq)
  const answer = await groqChat([{ role: "user", content: "Say 'smoke test passed'" }]);
  console.log(`Chat model: ${GROQ_MODEL}`);
  console.log("Chat response:", answer);
  console.log("Smoke test passed");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
