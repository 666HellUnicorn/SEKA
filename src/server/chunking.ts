import type { KnowledgeChunk, ParsedPage } from "../shared/types.ts";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "./config.ts";
import { tokenize } from "./retrieval.ts";
import { newId, utcNow } from "./utils.ts";

function cleanText(text: string): string {
  return text
    .replaceAll("\u0000", " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function paragraphs(text: string): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  return cleaned
    .split(/\n\s*\n/g)
    .map((part) => part.replace(/\s*\n\s*/g, "\n").trim())
    .filter(Boolean);
}

export function splitText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const parts = paragraphs(text);
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    if (part.length > size) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      const step = Math.max(1, size - overlap);
      for (let start = 0; start < part.length; start += step) {
        const window = part.slice(start, start + size).trim();
        if (window) chunks.push(window);
      }
      continue;
    }

    if (!current) {
      current = part;
    } else if (current.length + part.length + 2 <= size) {
      current += `\n\n${part}`;
    } else {
      chunks.push(current.trim());
      const prefix = overlap > 0 ? current.slice(-overlap).trim() : "";
      current = prefix ? `${prefix}\n\n${part}` : part;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function inferSectionTitle(text: string): string {
  for (const line of text.split(/\r?\n/g)) {
    const stripped = line.trim();
    if (!stripped) continue;
    if (stripped.startsWith("#")) return stripped.replace(/^#+/, "").trim().slice(0, 80);
    if (stripped.length <= 40) return stripped.slice(0, 80);
    return stripped.slice(0, 80);
  }
  return "";
}

export function makeChunks(documentId: string, pages: ParsedPage[]): KnowledgeChunk[] {
  const now = utcNow();
  const chunks: KnowledgeChunk[] = [];
  for (const page of pages) {
    for (const content of splitText(page.text)) {
      chunks.push({
        id: newId(),
        documentId,
        chunkIndex: chunks.length,
        content,
        pageNumber: page.pageNumber,
        sectionTitle: inferSectionTitle(content),
        tokenCount: tokenize(content).length,
        createdAt: now,
      });
    }
  }
  return chunks;
}

