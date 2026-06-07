import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = resolve(__dirname, "../..");
export const DATA_DIR = resolve(process.env.SEKA_DATA_DIR ?? resolve(ROOT_DIR, "data"));
export const UPLOAD_DIR = resolve(process.env.SEKA_UPLOAD_DIR ?? resolve(DATA_DIR, "uploads"));
export const DB_PATH = resolve(process.env.SEKA_DB_PATH ?? resolve(DATA_DIR, "seka.db"));
export const WEB_DIR = resolve(process.env.SEKA_WEB_DIR ?? resolve(ROOT_DIR, "web"));

export const HOST = process.env.SEKA_HOST ?? "127.0.0.1";
export const PORT = Number.parseInt(process.env.SEKA_PORT ?? "8765", 10);

export const CHUNK_SIZE = Number.parseInt(process.env.SEKA_CHUNK_SIZE ?? "900", 10);
export const CHUNK_OVERLAP = Number.parseInt(process.env.SEKA_CHUNK_OVERLAP ?? "140", 10);
export const MAX_UPLOAD_BYTES = Number.parseInt(
  process.env.SEKA_MAX_UPLOAD_BYTES ?? String(50 * 1024 * 1024),
  10,
);

export const ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".json",
  ".csv",
]);

