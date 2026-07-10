package com.seka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;

@Service
class AuthService {
  private final UserRepository users;
  private final SessionRepository sessions;
  private final AuditLogRepository auditLogs;
  private final ObjectMapper objectMapper;
  private final String adminUsername;
  private final String adminPassword;

  AuthService(UserRepository users, SessionRepository sessions, AuditLogRepository auditLogs, ObjectMapper objectMapper,
              @Value("${seka.admin.username}") String adminUsername,
              @Value("${seka.admin.password}") String adminPassword) {
    this.users = users;
    this.sessions = sessions;
    this.auditLogs = auditLogs;
    this.objectMapper = objectMapper;
    this.adminUsername = adminUsername;
    this.adminPassword = adminPassword;
    bootstrap();
  }

  private void bootstrap() {
    if (users.count() > 0) return;
    String salt = randomToken(16);
    UserEntity admin = new UserEntity(id(), adminUsername, "Administrator", Role.ADMIN, true, "", hash(adminPassword, salt), salt, now(), "");
    users.save(admin);
    audit(null, "system.bootstrap_admin", "user", admin.username, Map.of("username", admin.username));
  }

  AuthSession login(String username, String password) {
    UserEntity user = users.findByUsername(username == null ? "" : username.trim()).orElseThrow(() -> new ApiException(401, "用户名或密码错误"));
    if (!Objects.equals(user.passwordHash, hash(password, user.salt))) throw new ApiException(401, "用户名或密码错误");
    if (!user.active) throw new ApiException(401, "用户已被禁用");
    user.lastLoginAt = now();
    users.save(user);
    AuthSession session = new AuthSession(randomToken(32), toPublic(user), Instant.now().plusSeconds(7 * 24 * 3600).toString());
    sessions.save(new SessionEntity(session.token(), user.id, session.expiresAt(), now()));
    audit(session.user(), "auth.login", "user", user.id, Map.of());
    return session;
  }

  void logout(String token, PublicUser user) {
    sessions.deleteById(token);
    audit(user, "auth.logout", "session", token.length() > 8 ? token.substring(0, 8) : token, Map.of());
  }

  AuthSession getSession(String token) {
    if (token == null || token.isBlank()) return null;
    Optional<SessionEntity> session = sessions.findById(token);
    if (session.isEmpty()) return null;
    if (Instant.parse(session.get().expiresAt).isBefore(Instant.now())) {
      sessions.deleteById(token);
      return null;
    }
    Optional<UserEntity> user = users.findById(session.get().userId);
    if (user.isEmpty() || !user.get().active) {
      sessions.deleteById(token);
      return null;
    }
    return new AuthSession(token, toPublic(user.get()), session.get().expiresAt);
  }

  boolean hasPermission(PublicUser user, Permission permission) {
    if (user == null) return false;
    return switch (user.role()) {
      case ADMIN -> true;
      case EDITOR -> permission == Permission.READ || permission == Permission.WRITE;
      case VIEWER -> permission == Permission.READ;
    };
  }

  boolean canAccessWorkspace(PublicUser user, String workspace) {
    if (user == null) return false;
    if (user.role() == Role.ADMIN) return true;
    if (workspace == null || workspace.isBlank() || "all".equals(workspace)) return user.allowedWorkspaces().isEmpty();
    return user.allowedWorkspaces().isEmpty() || user.allowedWorkspaces().contains(workspace);
  }

  List<WorkspaceSummary> filterReadableWorkspaces(PublicUser user, List<WorkspaceSummary> workspaces) {
    if (user.role() == Role.ADMIN || user.allowedWorkspaces().isEmpty()) return workspaces;
    return workspaces.stream().filter(w -> user.allowedWorkspaces().contains(w.name())).toList();
  }

  List<PublicUser> listUsers() {
    return users.findAll().stream().sorted(Comparator.comparing(u -> u.createdAt)).map(this::toPublic).toList();
  }

  PublicUser createUser(CreateUserRequest request, PublicUser actor) {
    if (!hasPermission(actor, Permission.ADMIN)) throw new ApiException(403, "权限不足，需要 admin 权限");
    String username = request.username() == null ? "" : request.username().trim();
    if (username.isBlank()) throw new ApiException(400, "用户名不能为空");
    if (users.findByUsername(username).isPresent()) throw new ApiException(400, "用户已存在");
    if (request.password() == null || request.password().length() < 6) throw new ApiException(400, "密码至少 6 位");
    Role role = Role.valueOf((request.role() == null ? "viewer" : request.role()).trim().toUpperCase(Locale.ROOT));
    String salt = randomToken(16);
    UserEntity user = new UserEntity(id(), username, username, role, true, join(normalizeWorkspaces(request.allowedWorkspaces())), hash(request.password(), salt), salt, now(), "");
    users.save(user);
    audit(actor, "user.create", "user", user.id, Map.of("username", user.username, "role", user.role.name()));
    return toPublic(user);
  }

  @Transactional
  PublicUser setUserActive(String userId, boolean active, PublicUser actor) {
    if (!hasPermission(actor, Permission.ADMIN)) throw new ApiException(403, "权限不足，需要 admin 权限");
    UserEntity user = users.findById(userId).orElseThrow(() -> new ApiException(404, "用户不存在"));
    if (actor.id().equals(userId) && !active) throw new ApiException(400, "不能禁用当前登录的管理员自己");
    user.active = active;
    users.save(user);
    if (!active) sessions.deleteByUserId(userId);
    audit(actor, active ? "user.enable" : "user.disable", "user", user.id, Map.of("username", user.username, "role", user.role.name()));
    return toPublic(user);
  }

  PublicUser setUserWorkspaces(String userId, String allowedWorkspaces, PublicUser actor) {
    if (!hasPermission(actor, Permission.ADMIN)) throw new ApiException(403, "权限不足，需要 admin 权限");
    UserEntity user = users.findById(userId).orElseThrow(() -> new ApiException(404, "用户不存在"));
    user.allowedWorkspaces = join(normalizeWorkspaces(allowedWorkspaces));
    users.save(user);
    audit(actor, "user.workspace_update", "user", user.id, Map.of("username", user.username, "allowedWorkspaces", split(user.allowedWorkspaces)));
    return toPublic(user);
  }

  List<AuditLogItem> auditLogs() {
    return auditLogs.findTop200ByOrderByCreatedAtDesc().stream().map(row ->
        new AuditLogItem(row.id, row.userId, row.username, row.action, row.resourceType, row.resourceId, parseDetail(row.detail), row.createdAt)
    ).toList();
  }

  void audit(PublicUser user, String action, String resourceType, String resourceId, Map<String, Object> detail) {
    auditLogs.save(new AuditLogEntity(id(), user == null ? "" : user.id(), user == null ? "" : user.username(), action, resourceType, resourceId, toJson(detail), now()));
  }

  private PublicUser toPublic(UserEntity user) {
    return new PublicUser(user.id, user.username, user.displayName, user.role, user.active, split(user.allowedWorkspaces), user.createdAt, user.lastLoginAt);
  }

  static List<String> normalizeWorkspaces(String value) { return split(value).stream().filter(item -> !"all".equals(item)).distinct().limit(50).toList(); }
  private static List<String> split(String value) { return value == null || value.isBlank() ? List.of() : Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isBlank()).toList(); }
  private static String join(List<String> value) { return String.join(",", value); }

  private String toJson(Map<String, Object> detail) {
    try {
      return objectMapper.writeValueAsString(detail == null ? Map.of() : detail);
    } catch (Exception error) {
      throw new IllegalStateException("审计日志序列化失败", error);
    }
  }

  private Map<String, Object> parseDetail(String detail) {
    if (detail == null || detail.isBlank()) return Map.of();
    try {
      return objectMapper.readValue(detail, new TypeReference<>() {});
    } catch (Exception error) {
      return Map.of("raw", detail);
    }
  }

  private static String hash(String password, String salt) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] data = digest.digest((salt + ":" + password).getBytes(StandardCharsets.UTF_8));
      StringBuilder builder = new StringBuilder();
      for (byte b : data) builder.append(String.format("%02x", b));
      return builder.toString();
    } catch (Exception error) { throw new IllegalStateException(error); }
  }
  private static String randomToken(int bytes) { byte[] data = new byte[bytes]; new SecureRandom().nextBytes(data); StringBuilder builder = new StringBuilder(); for (byte b : data) builder.append(String.format("%02x", b)); return builder.toString(); }
  private static String id() { return UUID.randomUUID().toString().replace("-", ""); }
  private static String now() { return Instant.now().toString(); }
}
