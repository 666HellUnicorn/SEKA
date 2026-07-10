package com.seka;

import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
class KnowledgeService {
  private final DocumentRepository documents;
  private final ChunkRepository chunks;
  private final FeedbackRepository feedback;
  private final Path dataDir;

  KnowledgeService(DocumentRepository documents, ChunkRepository chunks, FeedbackRepository feedback,
                   @Value("${seka.data-dir}") String dataDir) throws IOException {
    this.documents = documents;
    this.chunks = chunks;
    this.feedback = feedback;
    this.dataDir = Path.of(dataDir).toAbsolutePath();
    Files.createDirectories(this.dataDir.resolve("uploads"));
  }

  @Transactional
  KnowledgeDocument ingest(MultipartFile file, String title, String workspace, String tags, String description) throws IOException {
    String id = id();
    String filename = StringUtils.cleanPath(Objects.requireNonNullElse(file.getOriginalFilename(), "upload.txt"));
    Path target = dataDir.resolve("uploads").resolve(id + "-" + filename);
    file.transferTo(target);
    String text = Files.readString(target, StandardCharsets.UTF_8);
    List<ChunkEntity> madeChunks = chunk(id, text);
    String now = now();
    DocumentEntity doc = new DocumentEntity(id, title == null || title.isBlank() ? filename : title.trim(), filename, target.toString(), normalizeWorkspace(workspace), normalizeTags(tags), description == null ? "" : description, "ready", text.substring(0, Math.min(300, text.length())), file.getSize(), madeChunks.size(), now, now);
    documents.save(doc);
    chunks.saveAll(madeChunks);
    return toDocument(doc);
  }

  List<KnowledgeDocument> listDocuments() {
    return documents.findAllByOrderByCreatedAtDesc().stream().map(this::toDocument).toList();
  }

  DocumentPage listDocuments(String workspace, String keyword, int page, int size, String sortBy, String sortDir, Collection<String> readableWorkspaces) {
    String scope = normalizeScope(workspace);
    String q = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
    int safePage = Math.max(0, page);
    int safeSize = Math.min(Math.max(1, size <= 0 ? 20 : size), 100);
    String safeSortBy = normalizeDocumentSortBy(sortBy);
    String safeSortDir = normalizeSortDir(sortDir);
    List<KnowledgeDocument> matched = listDocuments().stream()
        .filter(doc -> "all".equals(scope) || doc.workspace().equals(scope))
        .filter(doc -> readableWorkspaces == null || readableWorkspaces.contains(doc.workspace()))
        .filter(doc -> q.isBlank() || documentMatches(doc, q))
        .sorted(documentComparator(safeSortBy, safeSortDir))
        .toList();
    int from = Math.min(safePage * safeSize, matched.size());
    int to = Math.min(from + safeSize, matched.size());
    int totalPages = matched.isEmpty() ? 0 : (int) Math.ceil((double) matched.size() / safeSize);
    return new DocumentPage(matched.subList(from, to), safePage, safeSize, matched.size(), totalPages, scope, keyword == null ? "" : keyword.trim(), safeSortBy, safeSortDir);
  }

  KnowledgeDocument getDocument(String id) {
    return toDocument(findDocument(id));
  }

  @Transactional
  KnowledgeDocument updateDocumentMetadata(String id, DocumentMetadataRequest request) {
    DocumentEntity doc = findDocument(id);
    if (request.title() != null && !request.title().isBlank()) doc.title = request.title().trim();
    if (request.workspace() != null && !request.workspace().isBlank()) doc.workspace = normalizeWorkspace(request.workspace());
    if (request.tags() != null) doc.tags = normalizeTags(request.tags());
    if (request.description() != null) doc.description = request.description().trim();
    doc.updatedAt = now();
    documents.save(doc);
    return toDocument(doc);
  }

  @Transactional
  ReindexResult replaceDocumentContent(String id, MultipartFile file) throws IOException {
    DocumentEntity doc = findDocument(id);
    int oldChunkCount = doc.chunkCount;
    String oldFilePath = doc.filePath;
    String filename = StringUtils.cleanPath(Objects.requireNonNullElse(file.getOriginalFilename(), doc.filename == null || doc.filename.isBlank() ? "upload.txt" : doc.filename));
    Path target = dataDir.resolve("uploads").resolve(id + "-" + now().replace(":", "").replace(".", "") + "-" + filename);
    file.transferTo(target);
    String text = Files.readString(target, StandardCharsets.UTF_8);
    List<ChunkEntity> madeChunks = chunk(id, text);
    chunks.deleteByDocumentId(id);
    chunks.saveAll(madeChunks);
    doc.filename = filename;
    doc.filePath = target.toString();
    doc.sizeBytes = file.getSize();
    doc.summary = text.substring(0, Math.min(300, text.length()));
    doc.chunkCount = madeChunks.size();
    doc.status = "ready";
    doc.updatedAt = now();
    documents.save(doc);
    if (oldFilePath != null && !oldFilePath.isBlank() && !oldFilePath.equals(target.toString())) {
      try { Files.deleteIfExists(Path.of(oldFilePath)); } catch (IOException ignored) {}
    }
    return new ReindexResult(toDocument(doc), oldChunkCount, madeChunks.size(), filename);
  }

  @Transactional
  void deleteDocument(String id) {
    DocumentEntity doc = findDocument(id);
    chunks.deleteByDocumentId(id);
    documents.delete(doc);
    if (doc.filePath != null && !doc.filePath.isBlank()) {
      try { Files.deleteIfExists(Path.of(doc.filePath)); } catch (IOException ignored) {}
    }
  }

  List<KnowledgeChunk> listChunks(String documentId) {
    return chunks.findByDocumentIdOrderByChunkIndexAsc(documentId).stream().map(this::toChunk).toList();
  }

  List<WorkspaceSummary> workspaces() {
    return documents.findAll().stream().collect(Collectors.groupingBy(doc -> doc.workspace)).entrySet().stream()
        .map(entry -> new WorkspaceSummary(entry.getKey(), entry.getValue().size(), entry.getValue().stream().mapToInt(doc -> doc.chunkCount).sum()))
        .sorted(Comparator.comparing(WorkspaceSummary::name))
        .toList();
  }

  SearchResult search(String query, int topK, String workspace) {
    String scope = normalizeScope(workspace);
    List<CitationSource> results = allChunks(scope).stream()
        .map(chunk -> score(chunk, query))
        .filter(source -> source.score() > 0)
        .sorted(Comparator.comparing(CitationSource::score).reversed())
        .limit(topK <= 0 ? 8 : topK)
        .toList();
    return new SearchResult(query, scope, renumber(results));
  }

  QueryResult query(String question, int topK, String workspace) {
    SearchResult search = search(question, topK <= 0 ? 5 : topK, workspace);
    String answer = search.results().isEmpty()
        ? "当前知识库没有检索到足够相关的内容。"
        : "根据知识库：\n" + search.results().stream().map(CitationSource::snippet).collect(Collectors.joining("\n\n"));
    return new QueryResult(id(), question, answer, "java-jpa-local-extractive", search.results());
  }

  AgentRunResult agentRun(String task, String workspace, int topK) {
    String intent = detectIntent(task);
    QueryResult result = query(task, topK <= 0 ? 6 : topK, workspace);
    AgentToolCall call = new AgentToolCall(id(), "knowledge.query", Map.of("task", task, "workspace", normalizeScope(workspace)), "命中来源 " + result.sources().size() + " 条", "success", now(), now());
    String answer = switch (intent) {
      case "gap_analysis" -> "知识缺口分析：建议补充制度、流程、FAQ、项目复盘和高频问题。\n\n" + result.answer();
      case "summarize" -> "知识库总结：\n" + result.answer();
      case "compare" -> "对比分析：\n" + result.answer();
      default -> result.answer();
    };
    return new AgentRunResult(id(), intent, task, normalizeScope(workspace), answer, result.sources(), List.of(call), now());
  }

  FeedbackItem submitFeedback(FeedbackRequest request) {
    FeedbackEntity row = new FeedbackEntity(id(), request.qaId(), request.question(), request.answer(), normalizeWorkspace(request.workspace()), request.feedbackType(), request.comment(), "open", "", "", "", now());
    feedback.save(row);
    return toFeedback(row);
  }

  FeedbackItem getFeedback(String id) {
    return toFeedback(findFeedback(id));
  }

  @Transactional
  FeedbackItem resolveFeedback(String id, String resolution, PublicUser actor) {
    FeedbackEntity row = findFeedback(id);
    row.status = "resolved";
    row.resolution = resolution == null || resolution.isBlank() ? "已确认并完成修正" : resolution.trim();
    row.resolvedBy = actor.username();
    row.resolvedAt = now();
    feedback.save(row);
    return toFeedback(row);
  }

  List<FeedbackItem> feedback(String workspace) {
    String scope = normalizeScope(workspace);
    return ("all".equals(scope) ? feedback.findTop100ByOrderByCreatedAtDesc() : feedback.findTop100ByWorkspaceOrderByCreatedAtDesc(scope))
        .stream()
        .map(this::toFeedback)
        .toList();
  }

  String exportMarkdownReport(String workspace) {
    String scope = normalizeScope(workspace);
    List<KnowledgeDocument> docs = listDocuments().stream().filter(doc -> "all".equals(scope) || doc.workspace().equals(scope)).toList();
    List<WorkspaceSummary> summaries = workspaces().stream().filter(item -> "all".equals(scope) || item.name().equals(scope)).toList();
    List<FeedbackItem> feedbackItems = feedback(scope);
    long open = feedbackItems.stream().filter(item -> "open".equals(item.status())).count();
    long resolved = feedbackItems.stream().filter(item -> "resolved".equals(item.status())).count();
    StringBuilder md = new StringBuilder();
    md.append("# SEKA Java 知识库报告\n\n");
    md.append("- 导出时间：").append(now()).append("\n");
    md.append("- 导出空间：").append(scope).append("\n");
    md.append("- 文档数：").append(docs.size()).append("\n");
    md.append("- 待处理反馈：").append(open).append("\n");
    md.append("- 已修正反馈：").append(resolved).append("\n\n");
    md.append("## 知识空间\n\n");
    if (summaries.isEmpty()) md.append("- 暂无知识空间\n");
    summaries.forEach(item -> md.append("- ").append(item.name()).append(": ").append(item.documentCount()).append(" 文档 / ").append(item.chunkCount()).append(" chunks\n"));
    md.append("\n## 文档清单\n\n");
    if (docs.isEmpty()) md.append("- 暂无文档\n");
    docs.forEach(doc -> md.append("### ").append(doc.title()).append("\n\n")
        .append("- ID：").append(doc.id()).append("\n")
        .append("- 文件：").append(doc.filename()).append("\n")
        .append("- 状态：").append(doc.status()).append("\n")
        .append("- 空间：").append(doc.workspace()).append("\n")
        .append("- 标签：").append(String.join(", ", doc.tags())).append("\n")
        .append("- chunks：").append(doc.chunkCount()).append("\n")
        .append("- 更新时间：").append(doc.updatedAt()).append("\n")
        .append("- 说明：").append(doc.description().isBlank() ? "无" : doc.description()).append("\n\n")
        .append("摘要：").append(doc.summary().isBlank() ? "无" : doc.summary()).append("\n\n"));
    md.append("## 反馈状态\n\n");
    if (feedbackItems.isEmpty()) md.append("- 暂无反馈\n");
    feedbackItems.forEach(item -> md.append("- [").append(item.status()).append("] ").append(item.workspace()).append(" · ").append(item.feedbackType()).append(" · ").append(item.createdAt()).append("\n")
        .append("  - 问题：").append(item.question()).append("\n")
        .append("  - 反馈：").append(item.comment() == null || item.comment().isBlank() ? "无" : item.comment()).append("\n"));
    return md.toString();
  }

  private List<ChunkEntity> allChunks(String workspace) {
    Map<String, DocumentEntity> docMap = documents.findAll().stream().collect(Collectors.toMap(doc -> doc.id, doc -> doc));
    return chunks.findAll().stream()
        .filter(chunk -> "all".equals(workspace) || docMap.get(chunk.documentId).workspace.equals(workspace))
        .toList();
  }

  private CitationSource score(ChunkEntity chunk, String query) {
    DocumentEntity doc = findDocument(chunk.documentId);
    Set<String> terms = tokens(query);
    Set<String> content = tokens(chunk.content);
    long hits = terms.stream().filter(content::contains).count();
    double keyword = terms.isEmpty() ? 0 : (double) hits / terms.size();
    double contains = query != null && !query.isBlank() && chunk.content.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT)) ? 1 : 0;
    double score = keyword + contains;
    return new CitationSource(0, chunk.id, chunk.documentId, doc.title, doc.filename, chunk.pageNumber, chunk.sectionTitle, score, keyword, 0, chunk.content.substring(0, Math.min(500, chunk.content.length())));
  }

  private DocumentEntity findDocument(String id) { return documents.findById(id).orElseThrow(() -> new ApiException(404, "文档不存在")); }
  private FeedbackEntity findFeedback(String id) { return feedback.findById(id).orElseThrow(() -> new ApiException(404, "反馈不存在")); }
  private KnowledgeDocument toDocument(DocumentEntity doc) { return new KnowledgeDocument(doc.id, doc.title, doc.filename, doc.filePath, doc.workspace, split(doc.tags), doc.description, doc.status, doc.summary, doc.sizeBytes, doc.chunkCount, doc.createdAt, doc.updatedAt); }
  private KnowledgeChunk toChunk(ChunkEntity chunk) { return new KnowledgeChunk(chunk.id, chunk.documentId, chunk.chunkIndex, chunk.content, chunk.pageNumber, chunk.sectionTitle, chunk.tokenCount, chunk.createdAt); }
  private FeedbackItem toFeedback(FeedbackEntity row) { return new FeedbackItem(row.id, row.qaId, row.question, row.answer, row.workspace == null || row.workspace.isBlank() ? "default" : row.workspace, row.feedbackType, row.comment, row.status, row.resolution, row.resolvedBy, row.resolvedAt, row.createdAt); }

  private static List<CitationSource> renumber(List<CitationSource> sources) { List<CitationSource> output = new ArrayList<>(); for (int i = 0; i < sources.size(); i++) { CitationSource s = sources.get(i); output.add(new CitationSource(i + 1, s.chunkId(), s.documentId(), s.documentTitle(), s.documentFilename(), s.pageNumber(), s.sectionTitle(), s.score(), s.keywordScore(), s.vectorScore(), s.snippet())); } return output; }
  private static boolean documentMatches(KnowledgeDocument doc, String keyword) { return (doc.title() + " " + doc.filename() + " " + doc.workspace() + " " + String.join(" ", doc.tags()) + " " + doc.description() + " " + doc.summary()).toLowerCase(Locale.ROOT).contains(keyword); }
  private static Comparator<KnowledgeDocument> documentComparator(String sortBy, String sortDir) {
    Comparator<KnowledgeDocument> comparator = switch (sortBy) {
      case "title" -> Comparator.comparing(KnowledgeDocument::title, String.CASE_INSENSITIVE_ORDER);
      case "workspace" -> Comparator.comparing(KnowledgeDocument::workspace, String.CASE_INSENSITIVE_ORDER);
      case "filename" -> Comparator.comparing(KnowledgeDocument::filename, String.CASE_INSENSITIVE_ORDER);
      case "chunkCount" -> Comparator.comparingInt(KnowledgeDocument::chunkCount);
      case "sizeBytes" -> Comparator.comparingLong(KnowledgeDocument::sizeBytes);
      case "createdAt" -> Comparator.comparing(KnowledgeDocument::createdAt);
      default -> Comparator.comparing(KnowledgeDocument::updatedAt);
    };
    return "asc".equals(sortDir) ? comparator : comparator.reversed();
  }
  private static String normalizeDocumentSortBy(String value) {
    if (value == null || value.isBlank()) return "updatedAt";
    return switch (value.trim()) {
      case "createdAt", "updatedAt", "title", "workspace", "filename", "chunkCount", "sizeBytes" -> value.trim();
      default -> "updatedAt";
    };
  }
  private static String normalizeSortDir(String value) { return "asc".equalsIgnoreCase(value == null ? "" : value.trim()) ? "asc" : "desc"; }
  private static List<ChunkEntity> chunk(String documentId, String text) { List<ChunkEntity> result = new ArrayList<>(); int size = 700; for (int start = 0, index = 0; start < text.length(); start += size, index++) { String content = text.substring(start, Math.min(start + size, text.length())).trim(); if (!content.isBlank()) result.add(new ChunkEntity(id(), documentId, index, content, index + 1, "", content.length(), now())); } return result; }
  private static Set<String> tokens(String value) { if (value == null) return Set.of(); return Pattern.compile("[\\p{IsHan}A-Za-z0-9_]+").matcher(value.toLowerCase(Locale.ROOT)).results().map(match -> match.group()).filter(token -> token.length() >= 2).collect(Collectors.toSet()); }
  private static String normalizeTags(String value) { return String.join(",", split(value).stream().distinct().toList()); }
  private static List<String> split(String value) { return value == null || value.isBlank() ? List.of() : Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isBlank()).toList(); }
  private static String normalizeWorkspace(String value) { return value == null || value.isBlank() ? "default" : value.trim(); }
  private static String normalizeScope(String value) { return value == null || value.isBlank() ? "all" : value.trim(); }
  private static String detectIntent(String task) { String text = task == null ? "" : task; if (text.contains("缺口") || text.toLowerCase(Locale.ROOT).contains("gap")) return "gap_analysis"; if (text.contains("总结") || text.toLowerCase(Locale.ROOT).contains("summarize")) return "summarize"; if (text.contains("对比") || text.toLowerCase(Locale.ROOT).contains("compare")) return "compare"; return "answer"; }
  private static String id() { return UUID.randomUUID().toString().replace("-", ""); }
  private static String now() { return Instant.now().toString(); }
}
