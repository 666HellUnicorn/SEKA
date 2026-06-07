import { createHash } from "node:crypto";
import type { KnowledgeChunk, ScoredChunk } from "../shared/types.ts";

const WORD_RE = /[a-zA-Z0-9_]{2,}/g;
const CJK_RE = /[\u3400-\u9fff]/g;

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(WORD_RE) ?? [];
  const cjkChars = normalized.match(CJK_RE) ?? [];
  const cjkBigrams: string[] = [];
  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    cjkBigrams.push(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }
  return [...words, ...cjkChars, ...cjkBigrams];
}

function counter(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function hashEmbedding(tokens: string[], dims = 256): number[] {
  const vector = Array.from({ length: dims }, () => 0);
  const counts = counter(tokens);
  for (const [token, count] of counts.entries()) {
    const digest = createHash("blake2b512").update(token).digest();
    const index = digest.readUInt32BE(0) % dims;
    const sign = digest[4] & 1 ? 1 : -1;
    vector[index] += sign * Math.log1p(count);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function cosine(left: number[], right: number[]): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index] * right[index];
  }
  return sum;
}

export class HybridRetriever {
  private readonly vectorWeight: number;
  private readonly keywordWeight: number;

  constructor(vectorWeight = 0.35, keywordWeight = 0.65) {
    this.vectorWeight = vectorWeight;
    this.keywordWeight = keywordWeight;
  }

  retrieve(question: string, chunks: KnowledgeChunk[], topK = 5): ScoredChunk[] {
    if (!question.trim() || chunks.length === 0) return [];
    const queryTokens = tokenize(question);
    if (queryTokens.length === 0) return [];

    const queryCounts = counter(queryTokens);
    const tokenLists = chunks.map((chunk) => tokenize(chunk.content));
    const counters = tokenLists.map(counter);
    const docFreq = new Map<string, number>();

    for (const counts of counters) {
      for (const token of counts.keys()) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    const docCount = chunks.length;
    const avgLen = tokenLists.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, docCount);
    const queryVector = hashEmbedding(queryTokens);
    const scored: ScoredChunk[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const tokens = tokenLists[index];
      const counts = counters[index];
      if (tokens.length === 0) continue;

      let bm25 = 0;
      for (const [token, qtf] of queryCounts.entries()) {
        const tf = counts.get(token) ?? 0;
        if (tf <= 0) continue;
        const df = docFreq.get(token) ?? 0;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        const k1 = 1.4;
        const b = 0.75;
        bm25 +=
          idf *
          ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tokens.length / Math.max(avgLen, 1))))) *
          Math.log1p(qtf);
      }

      const vectorScore = Math.max(0, cosine(queryVector, hashEmbedding(tokens)));
      const keywordScore = bm25 > 0 ? bm25 / (bm25 + 3) : 0;
      const score = this.keywordWeight * keywordScore + this.vectorWeight * vectorScore;
      if (score <= 0) continue;
      scored.push({
        ...chunk,
        score: Number(score.toFixed(6)),
        keywordScore: Number(keywordScore.toFixed(6)),
        vectorScore: Number(vectorScore.toFixed(6)),
      });
    }

    return scored.sort((left, right) => right.score - left.score).slice(0, Math.max(1, topK));
  }
}
