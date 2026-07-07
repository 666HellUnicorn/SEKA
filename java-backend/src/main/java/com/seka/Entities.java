package com.seka;

import jakarta.persistence.*;

@Entity
@Table(name = "users")
class UserEntity {
  @Id String id;
  @Column(unique = true, nullable = false) String username;
  String displayName;
  @Enumerated(EnumType.STRING) Role role;
  boolean active;
  @Column(length = 2000) String allowedWorkspaces;
  String passwordHash;
  String salt;
  String createdAt;
  String lastLoginAt;

  protected UserEntity() {}

  UserEntity(String id, String username, String displayName, Role role, boolean active, String allowedWorkspaces,
             String passwordHash, String salt, String createdAt, String lastLoginAt) {
    this.id = id;
    this.username = username;
    this.displayName = displayName;
    this.role = role;
    this.active = active;
    this.allowedWorkspaces = allowedWorkspaces;
    this.passwordHash = passwordHash;
    this.salt = salt;
    this.createdAt = createdAt;
    this.lastLoginAt = lastLoginAt;
  }
}

@Entity
@Table(name = "sessions")
class SessionEntity {
  @Id String token;
  String userId;
  String expiresAt;
  String createdAt;
  protected SessionEntity() {}
  SessionEntity(String token, String userId, String expiresAt, String createdAt) {
    this.token = token;
    this.userId = userId;
    this.expiresAt = expiresAt;
    this.createdAt = createdAt;
  }
}

@Entity
@Table(name = "audit_logs")
class AuditLogEntity {
  @Id String id;
  String userId;
  String username;
  String action;
  String resourceType;
  String resourceId;
  @Column(length = 4000) String detail;
  String createdAt;
  protected AuditLogEntity() {}
  AuditLogEntity(String id, String userId, String username, String action, String resourceType, String resourceId, String detail, String createdAt) {
    this.id = id;
    this.userId = userId;
    this.username = username;
    this.action = action;
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    this.detail = detail;
    this.createdAt = createdAt;
  }
}

@Entity
@Table(name = "documents")
class DocumentEntity {
  @Id String id;
  String title;
  String filename;
  String filePath;
  String workspace;
  @Column(length = 2000) String tags;
  @Column(length = 2000) String description;
  String status;
  @Column(length = 1200) String summary;
  long sizeBytes;
  int chunkCount;
  String createdAt;
  String updatedAt;
  protected DocumentEntity() {}
  DocumentEntity(String id, String title, String filename, String filePath, String workspace, String tags, String description, String status, String summary, long sizeBytes, int chunkCount, String createdAt, String updatedAt) {
    this.id = id;
    this.title = title;
    this.filename = filename;
    this.filePath = filePath;
    this.workspace = workspace;
    this.tags = tags;
    this.description = description;
    this.status = status;
    this.summary = summary;
    this.sizeBytes = sizeBytes;
    this.chunkCount = chunkCount;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

@Entity
@Table(name = "chunks")
class ChunkEntity {
  @Id String id;
  String documentId;
  int chunkIndex;
  @Column(length = 6000) String content;
  Integer pageNumber;
  String sectionTitle;
  int tokenCount;
  String createdAt;
  protected ChunkEntity() {}
  ChunkEntity(String id, String documentId, int chunkIndex, String content, Integer pageNumber, String sectionTitle, int tokenCount, String createdAt) {
    this.id = id;
    this.documentId = documentId;
    this.chunkIndex = chunkIndex;
    this.content = content;
    this.pageNumber = pageNumber;
    this.sectionTitle = sectionTitle;
    this.tokenCount = tokenCount;
    this.createdAt = createdAt;
  }
}

@Entity
@Table(name = "feedback")
class FeedbackEntity {
  @Id String id;
  String qaId;
  @Column(length = 2000) String question;
  @Column(length = 4000) String answer;
  String feedbackType;
  @Column(length = 2000) String comment;
  String status;
  @Column(length = 4000) String resolution;
  String resolvedBy;
  String resolvedAt;
  String createdAt;
  protected FeedbackEntity() {}
  FeedbackEntity(String id, String qaId, String question, String answer, String feedbackType, String comment, String status, String resolution, String resolvedBy, String resolvedAt, String createdAt) {
    this.id = id;
    this.qaId = qaId;
    this.question = question;
    this.answer = answer;
    this.feedbackType = feedbackType;
    this.comment = comment;
    this.status = status;
    this.resolution = resolution;
    this.resolvedBy = resolvedBy;
    this.resolvedAt = resolvedAt;
    this.createdAt = createdAt;
  }
}
