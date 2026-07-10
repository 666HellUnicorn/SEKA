package com.seka;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;

interface UserRepository extends JpaRepository<UserEntity, String> {
  Optional<UserEntity> findByUsername(String username);
}

interface SessionRepository extends JpaRepository<SessionEntity, String> {
  void deleteByUserId(String userId);
}

interface AuditLogRepository extends JpaRepository<AuditLogEntity, String>, JpaSpecificationExecutor<AuditLogEntity> {
  List<AuditLogEntity> findTop200ByOrderByCreatedAtDesc();
}

interface DocumentRepository extends JpaRepository<DocumentEntity, String> {
  List<DocumentEntity> findByWorkspaceOrderByCreatedAtDesc(String workspace);
  List<DocumentEntity> findAllByOrderByCreatedAtDesc();
}

interface ChunkRepository extends JpaRepository<ChunkEntity, String> {
  List<ChunkEntity> findByDocumentIdOrderByChunkIndexAsc(String documentId);
  void deleteByDocumentId(String documentId);
}

interface FeedbackRepository extends JpaRepository<FeedbackEntity, String> {
  List<FeedbackEntity> findTop100ByOrderByCreatedAtDesc();
  List<FeedbackEntity> findTop100ByWorkspaceOrderByCreatedAtDesc(String workspace);
}
