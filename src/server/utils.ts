import { mkdirSync } from "node:fs";
import { DATA_DIR, UPLOAD_DIR } from "./config.ts";

export function ensureRuntimeDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function assertString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function safeFilename(filename: string): string {
  const clean = filename.replace(/[\\/:*?"<>|]/g, "_").trim();
  return clean || "untitled.txt";
}

export function normalizeExt(filename: string): string {
  const match = filename.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}
