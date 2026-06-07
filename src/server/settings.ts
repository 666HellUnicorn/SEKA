import type { RuntimeSettings } from "../shared/types.ts";
import {
  ALLOWED_EXTENSIONS,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DATA_DIR,
  DB_PATH,
  HOST,
  MAX_UPLOAD_BYTES,
  PORT,
  UPLOAD_DIR,
} from "./config.ts";

export function getRuntimeSettings(): RuntimeSettings {
  return {
    host: HOST,
    port: PORT,
    dataDir: DATA_DIR,
    uploadDir: UPLOAD_DIR,
    dbPath: DB_PATH,
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    allowedExtensions: [...ALLOWED_EXTENSIONS].sort(),
    ocrLang: process.env.SEKA_OCR_LANG ?? "eng",
    llmConfigured: Boolean(process.env.OPENAI_API_KEY ?? process.env.SEKA_LLM_API_KEY),
    llmBaseUrl: process.env.SEKA_LLM_BASE_URL ?? "https://api.openai.com/v1",
    llmModel: process.env.SEKA_LLM_MODEL ?? "gpt-4o-mini",
    nodeVersion: process.version,
    usingDefaultAdminPassword: !process.env.SEKA_ADMIN_PASSWORD,
  };
}
