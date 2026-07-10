package com.seka;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api")
class ApiController {
  private final KnowledgeService kb;
  private final AuthService auth;

  ApiController(KnowledgeService kb, AuthService auth) {
    this.kb = kb;
    this.auth = auth;
  }

  @GetMapping("/health")
  Map<String, Object> health() {
    return Map.of("status", "ok", "service", "SEKA Java", "runtime", "spring-boot");
  }

  @PostMapping("/auth/login")
  AuthSession login(@Valid @RequestBody LoginRequest request) { return auth.login(request.username(), request.password()); }

  @GetMapping("/auth/me")
  Map<String, Object> me(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    AuthSession session = requireRead(authorization);
    return Map.of("user", session.user(), "expiresAt", session.expiresAt());
  }

  @PostMapping("/auth/logout")
  Map<String, Object> logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    AuthSession session = requireRead(authorization);
    auth.logout(tokenOf(authorization), session.user());
    return Map.of("ok", true);
  }

  @PostMapping("/auth/password")
  Map<String, Object> changePassword(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody ChangePasswordRequest request) {
    AuthSession session = requireRead(authorization);
    auth.changePassword(session.user(), request);
    return Map.of("ok", true);
  }

  @GetMapping("/users")
  Map<String, Object> users(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    requireAdmin(authorization);
    return Map.of("users", auth.listUsers());
  }

  @PostMapping("/users")
  ResponseEntity<Map<String, Object>> createUser(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody CreateUserRequest request) {
    AuthSession session = requireAdmin(authorization);
    PublicUser user = auth.createUser(request, session.user());
    return ResponseEntity.status(201).body(Map.of("user", user));
  }

  @PostMapping("/users/{id}/status")
  Map<String, Object> setUserStatus(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id, @Valid @RequestBody UserStatusRequest request) {
    AuthSession session = requireAdmin(authorization);
    return Map.of("user", auth.setUserActive(id, request.isActive(), session.user()));
  }

  @PostMapping("/users/{id}/workspaces")
  Map<String, Object> setUserWorkspaces(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id, @Valid @RequestBody WorkspaceAuthRequest request) {
    AuthSession session = requireAdmin(authorization);
    return Map.of("user", auth.setUserWorkspaces(id, request.allowedWorkspaces(), session.user()));
  }

  @PostMapping("/users/{id}/password")
  Map<String, Object> resetUserPassword(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id, @Valid @RequestBody ResetPasswordRequest request) {
    AuthSession session = requireAdmin(authorization);
    return Map.of("user", auth.resetUserPassword(id, request.newPassword(), session.user()));
  }

  @GetMapping("/audit-logs")
  Map<String, Object> auditLogs(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestParam(defaultValue = "") String action,
      @RequestParam(defaultValue = "") String username,
      @RequestParam(defaultValue = "") String resourceType,
      @RequestParam(defaultValue = "200") int limit) {
    requireAdmin(authorization);
    return Map.of("auditLogs", auth.auditLogs(action, username, resourceType, limit));
  }

  @GetMapping("/documents")
  Map<String, Object> documents(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    AuthSession session = requireRead(authorization);
    return Map.of("documents", kb.listDocuments().stream().filter(document -> auth.canAccessWorkspace(session.user(), document.workspace())).toList());
  }

  @PostMapping(value = "/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  ResponseEntity<Map<String, Object>> upload(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @RequestPart("file") MultipartFile file, @RequestParam(defaultValue = "") String title,
      @RequestParam(defaultValue = "default") String workspace, @RequestParam(defaultValue = "") String tags,
      @RequestParam(defaultValue = "") String description) throws IOException {
    AuthSession session = requireWrite(authorization);
    requireWorkspace(session.user(), workspace);
    KnowledgeDocument document = kb.ingest(file, title, workspace, tags, description);
    auth.audit(session.user(), "document.upload", "document", document.id(), Map.of("title", document.title(), "workspace", document.workspace()));
    return ResponseEntity.status(201).body(Map.of("document", document));
  }

  @GetMapping("/documents/{id}")
  Map<String, Object> document(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id) {
    AuthSession session = requireRead(authorization);
    KnowledgeDocument document = kb.getDocument(id);
    requireWorkspace(session.user(), document.workspace());
    return Map.of("document", document);
  }

  @PatchMapping("/documents/{id}/metadata")
  Map<String, Object> updateDocumentMetadata(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id, @Valid @RequestBody DocumentMetadataRequest request) {
    AuthSession session = requireWrite(authorization);
    KnowledgeDocument before = kb.getDocument(id);
    requireWorkspace(session.user(), before.workspace());
    if (request.workspace() != null && !request.workspace().isBlank()) requireWorkspace(session.user(), request.workspace());
    KnowledgeDocument updated = kb.updateDocumentMetadata(id, request);
    auth.audit(session.user(), "document.update_metadata", "document", updated.id(), Map.of("workspace", updated.workspace(), "title", updated.title()));
    return Map.of("document", updated);
  }

  @PutMapping(value = "/documents/{id}/content", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  Map<String, Object> replaceDocumentContent(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
      @PathVariable String id, @RequestPart("file") MultipartFile file) throws IOException {
    AuthSession session = requireWrite(authorization);
    KnowledgeDocument before = kb.getDocument(id);
    requireWorkspace(session.user(), before.workspace());
    ReindexResult result = kb.replaceDocumentContent(id, file);
    auth.audit(session.user(), "document.reindex", "document", id, Map.of(
        "title", result.document().title(),
        "workspace", result.document().workspace(),
        "filename", result.filename(),
        "oldChunkCount", result.oldChunkCount(),
        "newChunkCount", result.newChunkCount()
    ));
    return Map.of("document", result.document(), "oldChunkCount", result.oldChunkCount(), "newChunkCount", result.newChunkCount());
  }

  @DeleteMapping("/documents/{id}")
  Map<String, Object> deleteDocument(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id) {
    AuthSession session = requireWrite(authorization);
    KnowledgeDocument document = kb.getDocument(id);
    requireWorkspace(session.user(), document.workspace());
    kb.deleteDocument(id);
    auth.audit(session.user(), "document.delete", "document", id, Map.of("workspace", document.workspace(), "title", document.title()));
    return Map.of("ok", true, "deletedId", id);
  }

  @GetMapping("/documents/{id}/chunks")
  Map<String, Object> chunks(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id) {
    AuthSession session = requireRead(authorization);
    KnowledgeDocument document = kb.getDocument(id);
    requireWorkspace(session.user(), document.workspace());
    return Map.of("chunks", kb.listChunks(id));
  }

  @GetMapping("/workspaces")
  Map<String, Object> workspaces(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    AuthSession session = requireRead(authorization);
    return Map.of("workspaces", auth.filterReadableWorkspaces(session.user(), kb.workspaces()));
  }

  @PostMapping("/search")
  SearchResult search(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody SearchRequest request) {
    AuthSession session = requireRead(authorization);
    requireWorkspace(session.user(), emptyToAll(request.workspace()));
    SearchResult result = kb.search(request.query(), request.topK(), request.workspace());
    auth.audit(session.user(), "knowledge.search", "search", "", Map.of("query", request.query(), "workspace", result.workspace()));
    return result;
  }

  @PostMapping("/query")
  QueryResult query(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody QueryRequest request) {
    AuthSession session = requireRead(authorization);
    requireWorkspace(session.user(), emptyToAll(request.workspace()));
    QueryResult result = kb.query(request.question(), request.topK(), request.workspace());
    auth.audit(session.user(), "knowledge.query", "qa", result.qaId(), Map.of("question", result.question(), "workspace", emptyToAll(request.workspace())));
    return result;
  }

  @PostMapping("/agent/run")
  AgentRunResult agent(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody AgentRequest request) {
    AuthSession session = requireRead(authorization);
    requireWorkspace(session.user(), emptyToAll(request.workspace()));
    AgentRunResult result = kb.agentRun(request.task(), request.workspace(), request.topK());
    auth.audit(session.user(), "agent.run", "agent_run", result.runId(), Map.of("intent", result.intent(), "workspace", result.workspace()));
    return result;
  }

  @PostMapping("/feedback")
  ResponseEntity<Map<String, Object>> feedback(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @Valid @RequestBody FeedbackRequest request) {
    AuthSession session = requireWrite(authorization);
    requireWorkspace(session.user(), emptyToDefault(request.workspace()));
    FeedbackItem item = kb.submitFeedback(request);
    auth.audit(session.user(), "feedback.create", "feedback", item.id(), Map.of("feedbackType", item.feedbackType(), "workspace", item.workspace()));
    return ResponseEntity.status(201).body(Map.of("feedback", item));
  }

  @PostMapping("/feedback/{id}/resolve")
  Map<String, Object> resolveFeedback(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @PathVariable String id, @Valid @RequestBody FeedbackResolveRequest request) {
    AuthSession session = requireWrite(authorization);
    FeedbackItem before = kb.getFeedback(id);
    requireWorkspace(session.user(), before.workspace());
    FeedbackItem item = kb.resolveFeedback(id, request.resolution(), session.user());
    auth.audit(session.user(), "feedback.resolve", "feedback", item.id(), Map.of("status", item.status(), "resolvedBy", item.resolvedBy(), "workspace", item.workspace()));
    return Map.of("feedback", item);
  }

  @GetMapping("/feedback")
  Map<String, Object> feedbackList(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestParam(defaultValue = "all") String workspace) {
    AuthSession session = requireRead(authorization);
    requireWorkspace(session.user(), workspace);
    return Map.of("feedback", kb.feedback(workspace).stream().filter(item -> auth.canAccessWorkspace(session.user(), item.workspace())).toList());
  }

  @GetMapping(value = "/export/markdown", produces = "text/markdown;charset=UTF-8")
  ResponseEntity<String> exportMarkdown(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization, @RequestParam(defaultValue = "all") String workspace) {
    AuthSession session = requireRead(authorization);
    requireWorkspace(session.user(), workspace);
    String markdown = kb.exportMarkdownReport(workspace);
    auth.audit(session.user(), "knowledge.export_markdown", "export", workspace, Map.of("workspace", workspace));
    return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"seka-report-" + workspace + ".md\"").body(markdown);
  }

  private AuthSession requireRead(String authorization) { return requirePermission(authorization, Permission.READ); }
  private AuthSession requireWrite(String authorization) { return requirePermission(authorization, Permission.WRITE); }
  private AuthSession requireAdmin(String authorization) { return requirePermission(authorization, Permission.ADMIN); }

  private AuthSession requirePermission(String authorization, Permission permission) {
    AuthSession session = auth.getSession(tokenOf(authorization));
    if (session == null) throw new ApiException(401, "请先登录");
    if (!auth.hasPermission(session.user(), permission)) throw new ApiException(403, "权限不足，需要 " + permission + " 权限");
    return session;
  }

  private void requireWorkspace(PublicUser user, String workspace) {
    if (!auth.canAccessWorkspace(user, workspace)) throw new ApiException(403, "无权访问知识空间：" + workspace);
  }

  private static String tokenOf(String authorization) {
    if (authorization == null) return "";
    return authorization.replaceFirst("(?i)^Bearer\\s+", "").trim();
  }
  private static String emptyToAll(String workspace) { return workspace == null || workspace.isBlank() ? "all" : workspace; }
  private static String emptyToDefault(String workspace) { return workspace == null || workspace.isBlank() ? "default" : workspace; }
}
