---
name: bm25-ranking
language: rust
category: retrieval
tags: [rust, retrieval, bm25, ranking, search, rag]
description: Lexical retrieval with BM25 in ~40 lines of std — chunk text, rank by relevance (IDF + length normalization), no embeddings, no dependencies
test: cargo test
---

# BM25 lexical ranking (no embeddings)

## Problem

You need to find the passages most relevant to a query — for RAG, code
search, or grounding an LLM answer. Exact substring search (grep) returns
everything unranked and drowns you in noise. The reflex is to reach for
embeddings + a vector DB, which needs a model (network or a heavy
dependency) and is overkill for most cases.

## Solution

`src/lib.rs` is the classic **BM25** ranker (what Lucene/Elasticsearch use)
in ~40 lines of std, zero dependencies:

- `chunk_lines(source, text, window, overlap)` — split text into overlapping
  line windows so a relevant passage isn't cut across a boundary.
- `bm25_top_k(query, chunks, k)` — score each chunk and return the best `k`.
  The score rewards **rare** query terms (IDF) and **normalizes for chunk
  length**, so a short passage full of the query's distinctive words beats a
  long one that merely repeats a common word.

## Key points

- **BM25 beats a naive keyword count** on the two things that matter: term
  rarity (IDF) and document length (the `b` parameter). A raw term-frequency
  count is dominated by common words and long documents.
- **The IDF `+1` (Lucene) variant** keeps common terms from scoring negative,
  so scores are always ≥ 0 and comparable.
- **Chunk overlap** (`window - overlap` step) is what stops a match from
  being split and missed; tune window/overlap to your content.
- **Naive tokenizer** (lowercase, split on non-alphanumerics): `retry` and
  `retries` don't match. A real system adds stemming — but this is enough to
  beat grep for relevance and stays dependency-free.
- **When embeddings do win**: semantic matching where the query and the text
  share meaning but no words (`"car"` vs `"automobile"`). For code and docs,
  lexical BM25 covers most of the value at a fraction of the cost.

## How to run

```bash
cargo test
```
