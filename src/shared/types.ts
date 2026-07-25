export type DocumentStatus = "processing" | "ready" | "no_text" | "error";
export type FeedbackType = "correct" | "wrong" | "save";
export type FeedbackStatus = "open" | "resolved";

export interface KnowledgeDocument {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  filePath: string;
  source: string;
  sourceUrl: string;
  workspace: string;
  tags: string[];
  description: string;
  status: DocumentStatus;
  parser: string;
  warnings: string[];
  summary: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionTitle: string;
  tokenCount: number;
  createdAt: string;
  documentTitle?: string;
  documentFilename?: string;
  documentSource?: string;
}

export interface ScoredChunk extends KnowledgeChunk {
  score: number;
  keywordScore: number;
  vectorScore: number;
}

export interface CitationSource {
  citationIndex: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentFilename: string;
  pageNumber: number | null;
  sectionTitle: string;
  score: number;
  keywordScore: number;
  vectorScore: number;
  snippet: string;
}

export interface QueryResult {
  qaId: string;
  question: string;
  answer: string;
  model: string;
  sources: CitationSource[];
}

export interface SearchResult {
  query: string;
  workspace: string;
  results: CitationSource[];
}

export interface AgenticSearchRequest {
  question: string;
  workspace?: string;
  topK?: number;
  maxRounds?: number;
}

export interface AgenticSearchQuery {
  query: string;
  terms: string[];
  reason: string;
}

export interface AgenticSearchRound {
  round: number;
  strategy: string;
  queries: AgenticSearchQuery[];
  hitCount: number;
  hits: CitationSource[];
}

export interface FeedbackItem {
  id: string;
  qaId: string | null;
  question: string;
  answer: string;
  feedbackType: FeedbackType;
  comment: string;
  status: FeedbackStatus;
  resolution: string;
  resolvedBy: string;
  resolvedAt: string;
  savedDocumentId: string;
  retrievedChunks: CitationSource[];
  createdAt: string;
  savedDocument?: KnowledgeDocument | null;
}

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedFile {
  text: string;
  pages: ParsedPage[];
  parser: string;
  warnings: string[];
  fileType: string;
  mimeType: string;
}

export interface ApiError {
  error: string;
}

export interface WorkspaceSummary {
  name: string;
  documentCount: number;
  chunkCount: number;
}

export interface KnowledgeStats {
  documentCount: number;
  readyDocumentCount: number;
  errorDocumentCount: number;
  chunkCount: number;
  workspaceCount: number;
  feedbackOpenCount: number;
  feedbackResolvedCount: number;
  qaCount: number;
  auditLogCount: number;
  userCount: number;
  totalSizeBytes: number;
  latestDocumentAt: string;
}

export interface RuntimeSettings {
  host: string;
  port: number;
  dataDir: string;
  uploadDir: string;
  dbPath: string;
  chunkSize: number;
  chunkOverlap: number;
  maxUploadBytes: number;
  allowedExtensions: string[];
  ocrLang: string;
  llmConfigured: boolean;
  llmBaseUrl: string;
  llmModel: string;
  nodeVersion: string;
  usingDefaultAdminPassword: boolean;
}

export type AgentIntent = "answer" | "compare" | "gap_analysis" | "ingest_url" | "summarize";
export type UserRole = "admin" | "editor" | "viewer";

export interface AgentToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  outputSummary: string;
  status: "success" | "error";
  startedAt: string;
  endedAt: string;
}

export interface AgentRunResult {
  runId: string;
  intent: AgentIntent;
  task: string;
  workspace: string;
  answer: string;
  sources: CitationSource[];
  toolCalls: AgentToolCall[];
  createdAt: string;
}

export interface AgenticSearchResult {
  question: string;
  workspace: string;
  answer: string;
  rounds: AgenticSearchRound[];
  sources: CitationSource[];
  toolCalls: AgentToolCall[];
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  allowedWorkspaces: string[];
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthSession {
  token: string;
  user: PublicUser;
  expiresAt: string;
}

export interface AuditLogItem {
  id: string;
  userId: string;
  username: string;
  action: string;
  resourceType: string;
  resourceId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}
