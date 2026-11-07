-- Enable pgvector extension (run on db startup via docker-entrypoint-initdb.d)
CREATE EXTENSION IF NOT EXISTS vector;