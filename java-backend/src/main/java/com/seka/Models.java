package com.seka;

import java.util.List;
import java.util.Map;

enum Role { ADMIN, EDITOR, VIEWER }
enum Permission { READ, WRITE, ADMIN }

record LoginRequest(String username, String password) {}
record CreateUserRequest(String username, String password, String role, String allowedWorkspaces) {}
record UserStatusRequest(boolean isActive) {}
record WorkspaceAuthRequest(String allowedWorkspaces) {}
record SearchRequest(String query, String workspace, int topK) {}
record QueryRequest(String question, String workspace, int topK) {}
record AgentRequest(String task, String workspace, int topK) {}
record FeedbackRequest(String qaId, String question, String answer, String feedbackType, String comment) {}

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
record KnowledgeChunk(String id, String documentId, int chunkIndex, String content, Integer pageNumber,
                      String sectionTitle, int tokenCount, String createdAt) {}
record CitationSource(int citationIndex, String chunkId, String documentId, String documentTitle, String documentFilename,
                      Integer pageNumber, String sectionTitle, double score, double keywordScore, double vectorScore,
                      String snippet) {}
record SearchResult(String query, String workspace, List<CitationSource> results) {}
record QueryResult(String qaId, String question, String answer, String model, List<CitationSource> sources) {}
record FeedbackItem(String id, String qaId, String question, String answer, String feedbackType, String comment,
                    String status, String resolution, String resolvedBy, String resolvedAt, String createdAt) {}
record WorkspaceSummary(String name, int documentCount, int chunkCount) {}
record AgentToolCall(String id, String toolName, Map<String, Object> input, String outputSummary, String status,
                     String startedAt, String endedAt) {}
record AgentRunResult(String runId, String intent, String task, String workspace, String answer,
                      List<CitationSource> sources, List<AgentToolCall> toolCalls, String createdAt) {}
