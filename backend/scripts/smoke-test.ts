import "../src/env";
import OpenAI from "openai";
import pgvector from "pgvector";

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

async function main() {
  if (!process.env.NVIDIA_API_KEY) {
    console.error("NVIDIA_API_KEY is not set");
    process.exit(1);
  }

  // 1. Embedding smoke test
  const emb = await client.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "nvidia/embed-qa-4",
    input: ["smoke test chunk"],
  });
  const vector = emb.data[0].embedding;
  console.log("Embedding dimensions:", vector.length);
  if (vector.length !== 2048) {
    console.warn(`Expected 2048 dims, got ${vector.length}`);
  }

  // 2. Chat smoke test
  const chat = await client.chat.completions.create({
    model: process.env.CHAT_MODEL || "nvidia/nemotron-4-340b-instruct",
    temperature: 0.1,
    messages: [{ role: "user", content: "Say 'smoke test passed'" }],
  });
  console.log("Chat response:", chat.choices[0]?.message?.content);
  console.log("Smoke test passed");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});