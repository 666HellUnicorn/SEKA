import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  AgenticSearchResult,
  CitationSource,
  FeedbackItem,
  FeedbackType,
  KnowledgeDocument,
  KnowledgeStats,
  QueryResult,
  ScoredChunk,
} from "../shared/types.ts";
import { AgenticSearchService } from "./agentic-search.ts";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, UPLOAD_DIR } from "./config.ts";
import { Database } from "./db.ts";
import { generateAnswer } from "./llm.ts";
import { makeChunks } from "./chunking.ts";
import { detectFileType, parseFile } from "./parsers.ts";
import { HybridRetriever } from "./retrieval.ts";
import { ensureRuntimeDirs, newId, normalizeExt, safeFilename } from "./utils.ts";
import { fetchWebPage } from "./web-source.ts";

export class KnowledgeBase {
  private readonly retriever = new HybridRetriever();
  private readonly agenticSearchService = new AgenticSearchService();
  private readonly db: Database;

  constructor(db = new Database()) {
    this.db = db;
    ensureRuntimeDirs();
  }

  async ingestBuffer(
    fileBuffer: Buffer,
    filename: string,
    options: {
      title?: string;
      source?: string;
      sourceUrl?: string;
      workspace?: string;
      tags?: string[];
      description?: string;
    } = {},
  ): Promise<KnowledgeDocument> {
    if (fileBuffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`文件过大，最大允许 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
    }

    const cleanFilename = safeFilename(filename);
    const ext = normalizeExt(cleanFilename);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`暂不支持该文件类型：${ext || "(无扩展名)"}`);
    }

    const documentId = newId();
    const targetPath = join(UPLOAD_DIR, `${documentId}${ext}`);
    writeFileSync(targetPath, fileBuffer);

    this.db.createDocument({
      id: documentId,
      title: options.title || basename(cleanFilename, ext) || "未命名文档",
      filename: cleanFilename,
      fileType: detectFileType(cleanFilename),
      filePath: targetPath,
      source: options.source ?? "upload",
      sourceUrl: options.sourceUrl ?? "",
      workspace: normalizeWorkspace(options.workspace),
      tags: normalizeTags(options.tags),
      description: options.description ?? "",
      sizeBytes: fileBuffer.byteLength,
    });

    return this.parseAndIndex(documentId);
  }

  async ingestTextKnowledge(
    title: string,
    content: string,
    source = "feedback",
    options: { workspace?: string; tags?: string[]; description?: string; sourceUrl?: string } = {},
  ): Promise<KnowledgeDocument> {
    return this.ingestBuffer(Buffer.from(content, "utf8"), `${title.slice(0, 40) || "knowledge"}.md`, {
      title,
      source,
      ...options,
    });
  }

  async importFromPath(path: string, title?: string): Promise<KnowledgeDocument> {
    if (!existsSync(path)) throw new Error(`文件不存在：${path}`);
    return this.ingestBuffer(readFileSync(path), basename(path), { title });
  }

  async ingestUrl(
    url: string,
    options: { title?: string; workspace?: string; tags?: string[]; description?: string } = {},
  ): Promise<KnowledgeDocument> {
    const page = await fetchWebPage(url);
    const title = options.title || page.title;
    const filename = `${title.slice(0, 48) || "web-page"}.md`;
    return this.ingestBuffer(Buffer.from(page.markdown, "utf8"), filename, {
      title,
      source: "web",
      sourceUrl: page.finalUrl,
      workspace: options.workspace,
      tags: normalizeTags([...(options.tags ?? []), "web"]),
      description: options.description || page.description,
    });
  }

  async parseAndIndex(documentId: string): Promise<KnowledgeDocument> {
    const doc = this.db.getDocument(documentId);
    if (!doc) throw new Error(`文档不存在：${documentId}`);

    try {
      const parsed = await parseFile(doc.filePath, doc.filename);
      const chunks = makeChunks(documentId, parsed.pages);
      this.db.replaceChunks(documentId, chunks);
      return this.db.updateDocument(documentId, {
        fileType: parsed.fileType,
        status: chunks.length > 0 ? "ready" : "no_text",
        parser: parsed.parser,
        warnings: parsed.warnings,
        summary: parsed.text.slice(0, 300),
        chunkCount: chunks.length,
      })!;
    } catch (error) {
      const updated = this.db.updateDocument(documentId, {
        status: "error",
        warnings: [`解析失败：${String(error)}`],
      });
      if (!updated) throw error;
      return updated;
    }
  }

  reindexDocument(documentId: string): Promise<KnowledgeDocument> {
    return this.parseAndIndex(documentId);
  }

  listDocuments(): KnowledgeDocument[] {
    return this.db.listDocuments();
  }

  listWorkspaces() {
    return this.db.listWorkspaces();
  }

  getDocument(documentId: string): KnowledgeDocument | null {
    return this.db.getDocument(documentId);
  }

  updateDocumentMetadata(
    documentId: string,
    fields: { title?: string; workspace?: string; tags?: string[] | string; description?: string },
  ): KnowledgeDocument {
    const doc = this.db.getDocument(documentId);
    if (!doc) throw new Error("文档不存在");
    const title = fields.title?.trim();
    const updated = this.db.updateDocument(documentId, {
      title: title || doc.title,
      workspace: normalizeWorkspace(fields.workspace ?? doc.workspace),
      tags: normalizeTags(fields.tags ?? doc.tags),
      description: fields.description ?? doc.description,
    });
    if (!updated) throw new Error("文档更新失败");
    return updated;
  }

  deleteDocument(documentId: string): boolean {
    const doc = this.db.getDocument(documentId);
    const deleted = this.db.deleteDocument(documentId);
    if (deleted && doc) {
      try {
        unlinkSync(doc.filePath);
      } catch {
        // ignore missing upload file
      }
    }
    return deleted;
  }

  listChunks(documentId: string) {
    return this.db.listChunks(documentId);
  }

  search(query: string, topK = 8, workspace?: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("检索关键词不能为空");
    const chunks = workspace && workspace !== "all" ? this.db.chunksByWorkspace(workspace) : this.db.allChunks();
    const retrieved = this.retriever.retrieve(normalizedQuery, chunks, topK);
    return {
      query: normalizedQuery,
      workspace: workspace || "all",
      results: retrieved.map((chunk, index) => this.toCitation(chunk, index + 1)),
    };
  }

  agenticSearch(
    question: string,
    options: { topK?: number; maxRounds?: number; workspace?: string } = {},
  ): AgenticSearchResult {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) throw new Error("问题不能为空");
    const chunks =
      options.workspace && options.workspace !== "all" ? this.db.chunksByWorkspace(options.workspace) : this.db.allChunks();
    return this.agenticSearchService.search(normalizedQuestion, chunks, {
      workspace: options.workspace || "all",
      topK: options.topK,
      maxRounds: options.maxRounds,
      toCitation: (chunk, citationIndex) => this.toCitation(chunk, citationIndex),
    });
  }

  async query(question: string, topK = 5, workspace?: string): Promise<QueryResult> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) throw new Error("问题不能为空");

    const chunks = workspace && workspace !== "all" ? this.db.chunksByWorkspace(workspace) : this.db.allChunks();
    const retrieved = this.retriever.retrieve(normalizedQuestion, chunks, topK);
    const answerResult = await generateAnswer(normalizedQuestion, retrieved);
    const sources = retrieved.map((chunk, index) => this.toCitation(chunk, index + 1));
    const qaId = newId();
    this.db.createQa({
      id: qaId,
      question: normalizedQuestion,
      answer: answerResult.answer,
      retrievedChunks: sources,
      model: answerResult.model,
    });

    return {
      qaId,
      question: normalizedQuestion,
      answer: answerResult.answer,
      model: answerResult.model,
      sources,
    };
  }

  async submitFeedback(input: {
    question: string;
    answer: string;
    feedbackType: FeedbackType;
    comment?: string;
    qaId?: string | null;
    retrievedChunks?: CitationSource[];
  }): Promise<FeedbackItem> {
    if (!["correct", "wrong", "save"].includes(input.feedbackType)) {
      throw new Error("feedbackType 必须是 correct、wrong 或 save");
    }
    const feedback = this.db.createFeedback({
      id: newId(),
      qaId: input.qaId,
      question: input.question,
      answer: input.answer,
      feedbackType: input.feedbackType,
      comment: input.comment,
      retrievedChunks: input.retrievedChunks,
    });

    if (input.feedbackType === "save") {
      const content = [
        "# 用户沉淀知识",
        "",
        "## 问题",
        "",
        input.question,
        "",
        "## 答案",
        "",
        input.answer,
        "",
        "## 用户补充",
        "",
        input.comment || "无",
      ].join("\n");
      feedback.savedDocument = await this.ingestTextKnowledge(`反馈知识-${input.question.slice(0, 24)}`, content, "feedback", {
        workspace: "feedback",
        tags: ["feedback", input.feedbackType],
      });
      feedback.savedDocumentId = feedback.savedDocument.id;
    }

    return feedback;
  }

  async resolveFeedback(input: {
    feedbackId: string;
    resolution: string;
    resolvedBy: string;
    saveAsKnowledge?: boolean;
  }): Promise<FeedbackItem> {
    const feedback = this.db.getFeedback(input.feedbackId);
    if (!feedback) throw new Error("反馈不存在");
    const resolution = input.resolution.trim();
    if (!resolution) throw new Error("修正说明不能为空");

    let savedDocumentId = "";
    if (input.saveAsKnowledge) {
      const content = [
        "# 反馈修正知识",
        "",
        "## 原问题",
        "",
        feedback.question,
        "",
        "## 原回答",
        "",
        feedback.answer,
        "",
        "## 用户反馈",
        "",
        feedback.comment || "无",
        "",
        "## 修正结论",
        "",
        resolution,
      ].join("\n");
      const doc = await this.ingestTextKnowledge(`修正知识-${feedback.question.slice(0, 24)}`, content, "feedback_resolution", {
        workspace: "feedback",
        tags: ["feedback", "resolved", feedback.feedbackType],
      });
      savedDocumentId = doc.id;
    }

    const resolved = this.db.resolveFeedback({
      id: input.feedbackId,
      resolution,
      resolvedBy: input.resolvedBy,
      savedDocumentId,
    });
    if (!resolved) throw new Error("反馈修正失败");
    return resolved;
  }

  listFeedback(workspaces?: string[]): FeedbackItem[] {
    const feedback = this.db.listFeedback();
    if (!workspaces || workspaces.length === 0) return feedback;
    const allowed = new Set(workspaces);
    return feedback.filter((item) => this.feedbackTouchesWorkspaces(item, allowed));
  }

  getStats(workspaces?: string[]): KnowledgeStats {
    if (!workspaces || workspaces.length === 0) return this.db.getStats();

    const allowed = new Set(workspaces);
    const documents = this.listDocuments().filter((document) => allowed.has(document.workspace));
    const feedback = this.listFeedback(workspaces);
    const qaIds = new Set(feedback.map((item) => item.qaId).filter((id): id is string => Boolean(id)));

    return {
      documentCount: documents.length,
      readyDocumentCount: documents.filter((document) => document.status === "ready").length,
      errorDocumentCount: documents.filter((document) => document.status === "error").length,
      chunkCount: documents.reduce((sum, document) => sum + document.chunkCount, 0),
      workspaceCount: new Set(documents.map((document) => document.workspace)).size,
      feedbackOpenCount: feedback.filter((item) => item.status === "open").length,
      feedbackResolvedCount: feedback.filter((item) => item.status === "resolved").length,
      qaCount: qaIds.size,
      auditLogCount: 0,
      userCount: 0,
      totalSizeBytes: documents.reduce((sum, document) => sum + document.sizeBytes, 0),
      latestDocumentAt: documents
        .map((document) => document.createdAt)
        .sort()
        .at(-1) ?? "",
    };
  }

  exportMarkdownReport(workspace = "all"): string {
    const normalizedWorkspace = workspace || "all";
    const docs = this.listDocuments().filter(
      (doc) => normalizedWorkspace === "all" || doc.workspace === normalizedWorkspace,
    );
    const workspaces = this.listWorkspaces().filter(
      (item) => normalizedWorkspace === "all" || item.name === normalizedWorkspace,
    );
    const feedback = this.listFeedback(normalizedWorkspace === "all" ? undefined : [normalizedWorkspace]);
    const stats = this.getStats(normalizedWorkspace === "all" ? undefined : [normalizedWorkspace]);
    const lines = [
      "# SEKA 知识库报告",
      "",
      `- 导出时间：${new Date().toISOString()}`,
      `- 导出空间：${normalizedWorkspace}`,
      `- 文档数：${docs.length}`,
      `- 全库 chunks：${stats.chunkCount}`,
      `- 待处理反馈：${stats.feedbackOpenCount}`,
      `- 已修正反馈：${stats.feedbackResolvedCount}`,
      "",
      "## 知识空间",
      "",
      ...(workspaces.length
        ? workspaces.map((item) => `- ${item.name}: ${item.documentCount} 文档 / ${item.chunkCount} chunks`)
        : ["- 暂无知识空间"]),
      "",
      "## 文档清单",
      "",
      ...(docs.length
        ? docs.map((doc) =>
            [
              `### ${doc.title}`,
              "",
              `- ID：${doc.id}`,
              `- 文件：${doc.filename}`,
              `- 状态：${doc.status}`,
              `- 空间：${doc.workspace}`,
              `- 标签：${doc.tags.join(", ") || "无"}`,
              `- chunks：${doc.chunkCount}`,
              `- 更新时间：${doc.updatedAt}`,
              doc.description ? `- 说明：${doc.description}` : "- 说明：无",
              "",
              doc.summary ? `摘要：${doc.summary}` : "摘要：无",
              "",
            ].join("\n"),
          )
        : ["- 暂无文档"]),
      "## 反馈状态",
      "",
      ...(feedback.length
        ? feedback.slice(0, 30).map((item) =>
            [
              `- [${item.status}] ${item.feedbackType} · ${item.createdAt}`,
              `  - 问题：${item.question}`,
              `  - 反馈：${item.comment || "无"}`,
              item.resolution ? `  - 修正：${item.resolution}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          )
        : ["- 暂无反馈"]),
      "",
    ];
    return lines.join("\n");
  }

  close(): void {
    this.db.close();
  }

  private toCitation(chunk: ScoredChunk, citationIndex: number): CitationSource {
    return {
      citationIndex,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle ?? "",
      documentFilename: chunk.documentFilename ?? "",
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
      score: chunk.score,
      keywordScore: chunk.keywordScore,
      vectorScore: chunk.vectorScore,
      snippet: chunk.content.slice(0, 700),
    };
  }

  private feedbackTouchesWorkspaces(item: FeedbackItem, allowed: Set<string>): boolean {
    if (
      item.retrievedChunks.some((source) => {
        const document = this.getDocument(source.documentId);
        return Boolean(document && allowed.has(document.workspace));
      })
    ) {
      return true;
    }
    if (!item.savedDocumentId) return false;
    const savedDocument = this.getDocument(item.savedDocumentId);
    return Boolean(savedDocument && allowed.has(savedDocument.workspace));
  }
}

export function normalizeWorkspace(workspace?: string): string {
  const value = (workspace ?? "default").trim();
  return value || "default";
}

export function normalizeTags(tags?: string[] | string): string[] {
  const raw = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
  return Array.from(
    new Set(
      raw
        .map((tag) => String(tag).trim())
        .filter(Boolean)
        .slice(0, 20),
    ),
  );
}
