import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditLogItem,
  CitationSource,
  FeedbackItem,
  FeedbackStatus,
  FeedbackType,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeStats,
  PublicUser,
  UserRole,
} from "../shared/types.ts";
import { DB_PATH } from "./config.ts";
import { utcNow } from "./utils.ts";

type DbRow = Record<string, unknown>;

function jsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function docFromRow(row: DbRow): KnowledgeDocument {
  return {
    id: String(row.id),
    title: String(row.title),
    filename: String(row.filename),
    fileType: String(row.file_type),
    filePath: String(row.file_path),
    source: String(row.source),
    sourceUrl: String(row.source_url ?? ""),
    workspace: String(row.workspace ?? "default"),
    tags: jsonParse<string[]>(row.tags, []),
    description: String(row.description ?? ""),
    status: row.status as KnowledgeDocument["status"],
    parser: String(row.parser ?? ""),
    warnings: jsonParse<string[]>(row.warnings, []),
    summary: String(row.summary ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function chunkFromRow(row: DbRow): KnowledgeChunk {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    chunkIndex: Number(row.chunk_index),
    content: String(row.content),
    pageNumber: row.page_number === null || row.page_number === undefined ? null : Number(row.page_number),
    sectionTitle: String(row.section_title ?? ""),
    tokenCount: Number(row.token_count ?? 0),
    createdAt: String(row.created_at),
    documentTitle: row.document_title === undefined ? undefined : String(row.document_title),
    documentFilename: row.document_filename === undefined ? undefined : String(row.document_filename),
    documentSource: row.document_source === undefined ? undefined : String(row.document_source),
  };
}

function feedbackFromRow(row: DbRow): FeedbackItem {
  return {
    id: String(row.id),
    qaId: row.qa_id === null || row.qa_id === undefined ? null : String(row.qa_id),
    question: String(row.question),
    answer: String(row.answer),
    feedbackType: row.feedback_type as FeedbackType,
    comment: String(row.comment ?? ""),
    status: (row.status ?? "open") as FeedbackStatus,
    resolution: String(row.resolution ?? ""),
    resolvedBy: String(row.resolved_by ?? ""),
    resolvedAt: String(row.resolved_at ?? ""),
    savedDocumentId: String(row.saved_document_id ?? ""),
    retrievedChunks: jsonParse<CitationSource[]>(row.retrieved_chunks, []),
    createdAt: String(row.created_at),
  };
}

function userFromRow(row: DbRow): PublicUser {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: row.role as UserRole,
    isActive: Number(row.is_active ?? 1) === 1,
    allowedWorkspaces: jsonParse<string[]>(row.allowed_workspaces, []),
    createdAt: String(row.created_at),
    lastLoginAt: String(row.last_login_at ?? ""),
  };
}

function auditFromRow(row: DbRow): AuditLogItem {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? ""),
    username: String(row.username ?? ""),
    action: String(row.action),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id ?? ""),
    detail: jsonParse<Record<string, unknown>>(row.detail, {}),
    createdAt: String(row.created_at),
  };
}

export interface CreateDocumentInput {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  filePath: string;
  source: string;
  sourceUrl?: string;
  workspace?: string;
  tags?: string[];
  description?: string;
  sizeBytes: number;
}

export class Database {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;

  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'upload',
        source_url TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT 'default',
        tags TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'processing',
        parser TEXT NOT NULL DEFAULT '',
        warnings TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        page_number INTEGER,
        section_title TEXT NOT NULL DEFAULT '',
        token_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS qa_history (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        retrieved_chunks TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL DEFAULT 'local-extractive',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        qa_id TEXT,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        feedback_type TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        resolution TEXT NOT NULL DEFAULT '',
        resolved_by TEXT NOT NULL DEFAULT '',
        resolved_at TEXT NOT NULL DEFAULT '',
        saved_document_id TEXT NOT NULL DEFAULT '',
        retrieved_chunks TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY(qa_id) REFERENCES qa_history(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        is_active INTEGER NOT NULL DEFAULT 1,
        allowed_workspaces TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    this.migrateSchema();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_page ON chunks(page_number);
      CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace);
      CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    `);
  }

  private migrateSchema(): void {
    const columns = (this.db.prepare("PRAGMA table_info(documents)").all() as DbRow[]).map((row) =>
      String(row.name),
    );
    const addColumn = (name: string, ddl: string) => {
      if (!columns.includes(name)) this.db.exec(`ALTER TABLE documents ADD COLUMN ${ddl}`);
    };
    addColumn("source_url", "source_url TEXT NOT NULL DEFAULT ''");
    addColumn("workspace", "workspace TEXT NOT NULL DEFAULT 'default'");
    addColumn("tags", "tags TEXT NOT NULL DEFAULT '[]'");
    addColumn("description", "description TEXT NOT NULL DEFAULT ''");

    const feedbackColumns = (this.db.prepare("PRAGMA table_info(feedback)").all() as DbRow[]).map((row) =>
      String(row.name),
    );
    const addFeedbackColumn = (name: string, ddl: string) => {
      if (!feedbackColumns.includes(name)) this.db.exec(`ALTER TABLE feedback ADD COLUMN ${ddl}`);
    };
    addFeedbackColumn("status", "status TEXT NOT NULL DEFAULT 'open'");
    addFeedbackColumn("resolution", "resolution TEXT NOT NULL DEFAULT ''");
    addFeedbackColumn("resolved_by", "resolved_by TEXT NOT NULL DEFAULT ''");
    addFeedbackColumn("resolved_at", "resolved_at TEXT NOT NULL DEFAULT ''");
    addFeedbackColumn("saved_document_id", "saved_document_id TEXT NOT NULL DEFAULT ''");

    const userColumns = (this.db.prepare("PRAGMA table_info(users)").all() as DbRow[]).map((row) => String(row.name));
    if (!userColumns.includes("is_active")) this.db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    if (!userColumns.includes("allowed_workspaces")) {
      this.db.exec("ALTER TABLE users ADD COLUMN allowed_workspaces TEXT NOT NULL DEFAULT '[]'");
    }
  }

  createDocument(input: CreateDocumentInput): KnowledgeDocument {
    const now = utcNow();
    this.db
      .prepare(`
        INSERT INTO documents (
          id, title, filename, file_type, file_path, source, source_url,
          workspace, tags, description, status,
          parser, warnings, summary, size_bytes, chunk_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.title,
        input.filename,
        input.fileType,
        input.filePath,
        input.source,
        input.sourceUrl ?? "",
        input.workspace ?? "default",
        JSON.stringify(input.tags ?? []),
        input.description ?? "",
        "processing",
        "",
        "[]",
        "",
        input.sizeBytes,
        0,
        now,
        now,
      );
    return this.getDocument(input.id)!;
  }

  updateDocument(id: string, fields: Partial<Omit<KnowledgeDocument, "id" | "createdAt">>): KnowledgeDocument | null {
    const entries = Object.entries(fields);
    if (entries.length === 0) return this.getDocument(id);

    const columnMap = new Map<string, string>([
      ["title", "title"],
      ["filename", "filename"],
      ["fileType", "file_type"],
      ["filePath", "file_path"],
      ["source", "source"],
      ["sourceUrl", "source_url"],
      ["workspace", "workspace"],
      ["tags", "tags"],
      ["description", "description"],
      ["status", "status"],
      ["parser", "parser"],
      ["warnings", "warnings"],
      ["summary", "summary"],
      ["sizeBytes", "size_bytes"],
      ["chunkCount", "chunk_count"],
      ["updatedAt", "updated_at"],
    ]);

    const updates: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of entries) {
      const column = columnMap.get(key);
      if (!column) continue;
      updates.push(`${column}=?`);
      values.push(key === "warnings" || key === "tags" ? JSON.stringify(value) : value);
    }
    updates.push("updated_at=?");
    values.push(utcNow(), id);

    this.db.prepare(`UPDATE documents SET ${updates.join(", ")} WHERE id=?`).run(...(values as any[]));
    return this.getDocument(id);
  }

  getDocument(id: string): KnowledgeDocument | null {
    const row = this.db.prepare("SELECT * FROM documents WHERE id=?").get(id) as DbRow | undefined;
    return row ? docFromRow(row) : null;
  }

  listDocuments(): KnowledgeDocument[] {
    return (this.db.prepare("SELECT * FROM documents ORDER BY created_at DESC").all() as DbRow[]).map(docFromRow);
  }

  deleteDocument(id: string): boolean {
    const result = this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
    return result.changes > 0;
  }

  replaceChunks(documentId: string, chunks: KnowledgeChunk[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM chunks WHERE document_id=?").run(documentId);
      const statement = this.db.prepare(`
        INSERT INTO chunks (
          id, document_id, chunk_index, content, page_number,
          section_title, token_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        statement.run(
          chunk.id,
          documentId,
          chunk.chunkIndex,
          chunk.content,
          chunk.pageNumber,
          chunk.sectionTitle,
          chunk.tokenCount,
          chunk.createdAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.updateDocument(documentId, { chunkCount: chunks.length });
  }

  listChunks(documentId: string): KnowledgeChunk[] {
    return (
      this.db
        .prepare(`
          SELECT c.*, d.title AS document_title, d.filename AS document_filename
          FROM chunks c
          JOIN documents d ON d.id = c.document_id
          WHERE c.document_id=?
          ORDER BY c.chunk_index ASC
        `)
        .all(documentId) as DbRow[]
    ).map(chunkFromRow);
  }

  allChunks(): KnowledgeChunk[] {
    return (
      this.db
        .prepare(`
          SELECT c.*, d.title AS document_title, d.filename AS document_filename, d.source AS document_source
          FROM chunks c
          JOIN documents d ON d.id = c.document_id
          ORDER BY d.created_at DESC, c.chunk_index ASC
        `)
        .all() as DbRow[]
    ).map(chunkFromRow);
  }

  chunksByWorkspace(workspace: string): KnowledgeChunk[] {
    return (
      this.db
        .prepare(`
          SELECT c.*, d.title AS document_title, d.filename AS document_filename, d.source AS document_source
          FROM chunks c
          JOIN documents d ON d.id = c.document_id
          WHERE d.workspace=?
          ORDER BY d.created_at DESC, c.chunk_index ASC
        `)
        .all(workspace) as DbRow[]
    ).map(chunkFromRow);
  }

  listWorkspaces(): Array<{ name: string; documentCount: number; chunkCount: number }> {
    return (
      this.db
        .prepare(`
          SELECT workspace AS name, COUNT(*) AS document_count, COALESCE(SUM(chunk_count), 0) AS chunk_count
          FROM documents
          GROUP BY workspace
          ORDER BY workspace ASC
        `)
        .all() as DbRow[]
    ).map((row) => ({
      name: String(row.name),
      documentCount: Number(row.document_count ?? 0),
      chunkCount: Number(row.chunk_count ?? 0),
    }));
  }

  createQa(input: {
    id: string;
    question: string;
    answer: string;
    retrievedChunks: CitationSource[];
    model: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO qa_history (id, question, answer, retrieved_chunks, model, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(input.id, input.question, input.answer, JSON.stringify(input.retrievedChunks), input.model, utcNow());
  }

  createFeedback(input: {
    id: string;
    qaId?: string | null;
    question: string;
    answer: string;
    feedbackType: FeedbackType;
    comment?: string;
    retrievedChunks?: CitationSource[];
    savedDocumentId?: string;
  }): FeedbackItem {
    this.db
      .prepare(`
        INSERT INTO feedback (
          id, qa_id, question, answer, feedback_type, comment, status,
          resolution, resolved_by, resolved_at, saved_document_id,
          retrieved_chunks, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.qaId ?? null,
        input.question,
        input.answer,
        input.feedbackType,
        input.comment ?? "",
        "open",
        "",
        "",
        "",
        input.savedDocumentId ?? "",
        JSON.stringify(input.retrievedChunks ?? []),
        utcNow(),
      );
    const row = this.db.prepare("SELECT * FROM feedback WHERE id=?").get(input.id) as DbRow;
    return feedbackFromRow(row);
  }

  listFeedback(): FeedbackItem[] {
    return (this.db.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all() as DbRow[]).map(feedbackFromRow);
  }

  getFeedback(id: string): FeedbackItem | null {
    const row = this.db.prepare("SELECT * FROM feedback WHERE id=?").get(id) as DbRow | undefined;
    return row ? feedbackFromRow(row) : null;
  }

  resolveFeedback(input: {
    id: string;
    resolution: string;
    resolvedBy: string;
    savedDocumentId?: string;
  }): FeedbackItem | null {
    this.db
      .prepare(`
        UPDATE feedback
        SET status='resolved', resolution=?, resolved_by=?, resolved_at=?, saved_document_id=?
        WHERE id=?
      `)
      .run(input.resolution, input.resolvedBy, utcNow(), input.savedDocumentId ?? "", input.id);
    return this.getFeedback(input.id);
  }

  createUser(input: {
    id: string;
    username: string;
    displayName: string;
    passwordHash: string;
    salt: string;
    role: UserRole;
    allowedWorkspaces?: string[];
  }): PublicUser {
    const now = utcNow();
    this.db
      .prepare(`
        INSERT INTO users (
          id, username, display_name, password_hash, salt, role,
          is_active, allowed_workspaces, created_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.username,
        input.displayName,
        input.passwordHash,
        input.salt,
        input.role,
        1,
        JSON.stringify(input.allowedWorkspaces ?? []),
        now,
        "",
      );
    return this.getUserById(input.id)!;
  }

  getUserByUsernameWithSecret(username: string): (PublicUser & { passwordHash: string; salt: string }) | null {
    const row = this.db.prepare("SELECT * FROM users WHERE username=?").get(username) as DbRow | undefined;
    if (!row) return null;
    return {
      ...userFromRow(row),
      passwordHash: String(row.password_hash),
      salt: String(row.salt),
    };
  }

  getUserById(id: string): PublicUser | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id=?").get(id) as DbRow | undefined;
    return row ? userFromRow(row) : null;
  }

  listUsers(): PublicUser[] {
    return (this.db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as DbRow[]).map(userFromRow);
  }

  countUsers(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM users").get() as DbRow;
    return Number(row.count ?? 0);
  }

  updateUserLastLogin(userId: string): void {
    this.db.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(utcNow(), userId);
  }

  updateUserPassword(userId: string, passwordHash: string, salt: string): PublicUser | null {
    const result = this.db
      .prepare("UPDATE users SET password_hash=?, salt=? WHERE id=?")
      .run(passwordHash, salt, userId);
    if (result.changes <= 0) return null;
    return this.getUserById(userId);
  }

  setUserActive(userId: string, isActive: boolean): PublicUser | null {
    const result = this.db.prepare("UPDATE users SET is_active=? WHERE id=?").run(isActive ? 1 : 0, userId);
    if (result.changes <= 0) return null;
    return this.getUserById(userId);
  }

  setUserWorkspaces(userId: string, allowedWorkspaces: string[]): PublicUser | null {
    const result = this.db
      .prepare("UPDATE users SET allowed_workspaces=? WHERE id=?")
      .run(JSON.stringify(allowedWorkspaces), userId);
    if (result.changes <= 0) return null;
    return this.getUserById(userId);
  }

  createSession(input: { token: string; userId: string; expiresAt: string }): void {
    this.db
      .prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(input.token, input.userId, input.expiresAt, utcNow());
  }

  getSession(token: string): { token: string; user: PublicUser; expiresAt: string } | null {
    const row = this.db
      .prepare(`
        SELECT s.token, s.expires_at, u.*
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token=?
      `)
      .get(token) as DbRow | undefined;
    if (!row) return null;
    return {
      token: String(row.token),
      user: userFromRow(row),
      expiresAt: String(row.expires_at),
    };
  }

  deleteSession(token: string): boolean {
    const result = this.db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    return result.changes > 0;
  }

  deleteOtherSessions(userId: string, keepToken: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(userId, keepToken);
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  }

  deleteExpiredSessions(now = utcNow()): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  }

  createAuditLog(input: {
    id: string;
    userId?: string;
    username?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    detail?: Record<string, unknown>;
  }): AuditLogItem {
    this.db
      .prepare(`
        INSERT INTO audit_logs (id, user_id, username, action, resource_type, resource_id, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.userId ?? "",
        input.username ?? "",
        input.action,
        input.resourceType,
        input.resourceId ?? "",
        JSON.stringify(input.detail ?? {}),
        utcNow(),
      );
    const row = this.db.prepare("SELECT * FROM audit_logs WHERE id=?").get(input.id) as DbRow;
    return auditFromRow(row);
  }

  listAuditLogs(limit = 100): AuditLogItem[] {
    return (
      this.db
        .prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?")
        .all(Math.max(1, Math.min(500, limit))) as DbRow[]
    ).map(auditFromRow);
  }

  getStats(): KnowledgeStats {
    const documentStats = this.db
      .prepare(
        `
          SELECT
            COUNT(*) AS document_count,
            SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) AS ready_document_count,
            SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_document_count,
            COALESCE(SUM(chunk_count), 0) AS chunk_count,
            COUNT(DISTINCT workspace) AS workspace_count,
            COALESCE(SUM(size_bytes), 0) AS total_size_bytes,
            COALESCE(MAX(created_at), '') AS latest_document_at
          FROM documents
        `,
      )
      .get() as DbRow;
    const feedbackStats = this.db
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS feedback_open_count,
            SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) AS feedback_resolved_count
          FROM feedback
        `,
      )
      .get() as DbRow;
    const qaStats = this.db.prepare("SELECT COUNT(*) AS count FROM qa_history").get() as DbRow;
    const auditStats = this.db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as DbRow;
    const userStats = this.db.prepare("SELECT COUNT(*) AS count FROM users").get() as DbRow;

    return {
      documentCount: Number(documentStats.document_count ?? 0),
      readyDocumentCount: Number(documentStats.ready_document_count ?? 0),
      errorDocumentCount: Number(documentStats.error_document_count ?? 0),
      chunkCount: Number(documentStats.chunk_count ?? 0),
      workspaceCount: Number(documentStats.workspace_count ?? 0),
      feedbackOpenCount: Number(feedbackStats.feedback_open_count ?? 0),
      feedbackResolvedCount: Number(feedbackStats.feedback_resolved_count ?? 0),
      qaCount: Number(qaStats.count ?? 0),
      auditLogCount: Number(auditStats.count ?? 0),
      userCount: Number(userStats.count ?? 0),
      totalSizeBytes: Number(documentStats.total_size_bytes ?? 0),
      latestDocumentAt: String(documentStats.latest_document_at ?? ""),
    };
  }
}
