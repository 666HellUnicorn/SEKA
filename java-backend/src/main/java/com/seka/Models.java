package com.seka;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Map;

enum Role { ADMIN, EDITOR, VIEWER }
enum Permission { READ, WRITE, ADMIN }

record LoginRequest(@NotBlank @Size(max = 80) String username, @NotBlank @Size(min = 6, max = 120) String password) {}
record ChangePasswordRequest(@NotBlank @Size(min = 6, max = 120) String oldPassword,
                             @NotBlank @Size(min = 6, max = 120) String newPassword) {}
record CreateUserRequest(@NotBlank @Size(max = 80) String username, @NotBlank @Size(min = 6, max = 120) String password,
                         @NotBlank @Size(max = 20) String role, @Size(max = 2000) String allowedWorkspaces) {}
record UserStatusRequest(boolean isActive) {}
record WorkspaceAuthRequest(@Size(max = 2000) String allowedWorkspaces) {}
record ResetPasswordRequest(@NotBlank @Size(min = 6, max = 120) String newPassword) {}
record SearchRequest(@NotBlank @Size(max = 1000) String query, @Size(max = 120) String workspace, @Min(0) int topK) {}
record QueryRequest(@NotBlank @Size(max = 2000) String question, @Size(max = 120) String workspace, @Min(0) int topK) {}
record AgentRequest(@NotBlank @Size(max = 2000) String task, @Size(max = 120) String workspace, @Min(0) int topK) {}
record FeedbackRequest(@Size(max = 120) String qaId, @NotBlank @Size(max = 2000) String question,
                       @NotBlank @Size(max = 4000) String answer, @Size(max = 120) String workspace,
                       @NotBlank @Size(max = 40) String feedbackType,
                       @Size(max = 2000) String comment) {}
record FeedbackResolveRequest(@NotBlank @Size(max = 4000) String resolution) {}
record DocumentMetadataRequest(@Size(max = 200) String title, @Size(max = 120) String workspace,
                               @Size(max = 2000) String tags, @Size(max = 2000) String description) {}

record PublicUser(String id, String username, String displayName, Role role, boolean isActive,
                  List<String> allowedWorkspaces, String createdAt, String lastLoginAt) {
  PublicUser withLastLoginAt(String value) { return new PublicUser(id, username, displayName, role, isActive, allowedWorkspaces, createdAt, value); }
  PublicUser withActive(boolean value) { return new PublicUser(id, username, displayName, role, value, allowedWorkspaces, createdAt, lastLoginAt); }
  PublicUser withAllowedWorkspaces(List<String> value) { return new PublicUser(id, username, displayName, role, isActive, value, createdAt, lastLoginAt); }
}
record UserSecret(PublicUser user, String passwordHash, String salt) {}
record AuthSession(String token, PublicUser user, String expiresAt) {}
record AuditLogItem(String id, String userId, String username, String action, String resourceType, String resourceId,
                    Map<String, Object> detail, String createdAt) {}

record KnowledgeDocument(String id, String title, String filename, String filePath, String workspace, List<String> tags,
                         String description, String status, String summary, long sizeBytes, int chunkCount,
                         String createdAt, String updatedAt) {}
record ReindexResult(KnowledgeDocument document, int oldChunkCount, int newChunkCount, String filename) {}
record KnowledgeChunk(String id, String documentId, int chunkIndex, String content, Integer pageNumber,
                      String sectionTitle, int tokenCount, String createdAt) {}
record CitationSource(int citationIndex, String chunkId, String documentId, String documentTitle, String documentFilename,
                      Integer pageNumber, String sectionTitle, double score, double keywordScore, double vectorScore,
                      String snippet) {}
record SearchResult(String query, String workspace, List<CitationSource> results) {}
record QueryResult(String qaId, String question, String answer, String model, List<CitationSource> sources) {}
record FeedbackItem(String id, String qaId, String question, String answer, String workspace, String feedbackType, String comment,
                    String status, String resolution, String resolvedBy, String resolvedAt, String createdAt) {}
record WorkspaceSummary(String name, int documentCount, int chunkCount) {}
record AgentToolCall(String id, String toolName, Map<String, Object> input, String outputSummary, String status,
                     String startedAt, String endedAt) {}
record AgentRunResult(String runId, String intent, String task, String workspace, String answer,
                      List<CitationSource> sources, List<AgentToolCall> toolCalls, String createdAt) {}
