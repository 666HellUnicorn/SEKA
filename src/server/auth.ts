import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthSession, PublicUser, UserRole } from "../shared/types.ts";
import { Database } from "./db.ts";
import { newId, utcNow } from "./utils.ts";

const SESSION_DAYS = 7;

export type Permission = "read" | "write" | "admin";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ["read", "write", "admin"],
  editor: ["read", "write"],
  viewer: ["read"],
};

const VALID_ROLES = new Set<UserRole>(["admin", "editor", "viewer"]);

export function normalizeRole(role: unknown): UserRole {
  if (typeof role === "string" && VALID_ROLES.has(role as UserRole)) {
    return role as UserRole;
  }
  throw new Error("角色必须是 admin、editor 或 viewer");
}

export function normalizeAllowedWorkspaces(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(
    new Set(
      raw
        .map((item) => String(item).trim())
        .filter((item) => item && item !== "all")
        .slice(0, 50),
    ),
  );
}

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = hashPassword(password, salt);
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sessionExpiry(): string {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  return expiresAt.toISOString();
}

export class AuthService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    this.ensureDefaultAdmin();
  }

  ensureDefaultAdmin(): void {
    if (this.db.countUsers() > 0) return;
    const username = process.env.SEKA_ADMIN_USERNAME ?? "admin";
    const password = process.env.SEKA_ADMIN_PASSWORD ?? "admin123";
    const salt = randomBytes(16).toString("hex");
    this.db.createUser({
      id: newId(),
      username,
      displayName: "Administrator",
      passwordHash: hashPassword(password, salt),
      salt,
      role: "admin",
    });
    this.audit(null, "system.bootstrap_admin", "user", username, {
      username,
      note: "默认账号已创建，请在正式使用前通过环境变量设置 SEKA_ADMIN_PASSWORD 或后续实现改密功能。",
    });
  }

  login(username: string, password: string): AuthSession {
    const user = this.db.getUserByUsernameWithSecret(username.trim());
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      throw new Error("用户名或密码错误");
    }
    if (!user.isActive) throw new Error("用户已被禁用");
    const token = randomBytes(32).toString("hex");
    const expiresAt = sessionExpiry();
    this.db.createSession({ token, userId: user.id, expiresAt });
    this.db.updateUserLastLogin(user.id);
    const publicUser = this.db.getUserById(user.id)!;
    this.audit(publicUser, "auth.login", "user", user.id);
    return { token, user: publicUser, expiresAt };
  }

  logout(token: string, user?: PublicUser | null): boolean {
    const deleted = this.db.deleteSession(token);
    if (deleted) this.audit(user ?? null, "auth.logout", "session", token.slice(0, 8));
    return deleted;
  }

  getSession(token: string): AuthSession | null {
    if (!token) return null;
    this.db.deleteExpiredSessions();
    const session = this.db.getSession(token);
    if (!session) return null;
    if (!session.user.isActive) {
      this.db.deleteSession(token);
      return null;
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.db.deleteSession(token);
      return null;
    }
    return session;
  }

  listUsers(): PublicUser[] {
    return this.db.listUsers();
  }

  createUser(
    input: { username: string; password: string; displayName?: string; role: unknown; allowedWorkspaces?: unknown },
    actor: PublicUser,
  ): PublicUser {
    this.requirePermission(actor, "admin");
    const username = input.username.trim();
    if (!username) throw new Error("用户名不能为空");
    if (input.password.length < 6) throw new Error("密码至少 6 位");
    const role = normalizeRole(input.role);
    const salt = randomBytes(16).toString("hex");
    const user = this.db.createUser({
      id: newId(),
      username,
      displayName: input.displayName?.trim() || username,
      passwordHash: hashPassword(input.password, salt),
      salt,
      role,
      allowedWorkspaces: normalizeAllowedWorkspaces(input.allowedWorkspaces),
    });
    this.audit(actor, "user.create", "user", user.id, { username: user.username, role: user.role });
    return user;
  }

  setUserWorkspaces(userId: string, allowedWorkspaces: unknown, actor: PublicUser): PublicUser {
    this.requirePermission(actor, "admin");
    const normalized = normalizeAllowedWorkspaces(allowedWorkspaces);
    const user = this.db.setUserWorkspaces(userId, normalized);
    if (!user) throw new Error("用户不存在");
    this.audit(actor, "user.workspace_update", "user", user.id, {
      username: user.username,
      allowedWorkspaces: user.allowedWorkspaces,
    });
    return user;
  }

  setUserActive(userId: string, isActive: boolean, actor: PublicUser): PublicUser {
    this.requirePermission(actor, "admin");
    if (actor.id === userId && !isActive) throw new Error("不能禁用当前登录的管理员自己");
    const user = this.db.setUserActive(userId, isActive);
    if (!user) throw new Error("用户不存在");
    if (!isActive) this.db.deleteUserSessions(userId);
    this.audit(actor, isActive ? "user.enable" : "user.disable", "user", user.id, {
      username: user.username,
      role: user.role,
    });
    return user;
  }

  changeOwnPassword(input: {
    user: PublicUser;
    currentPassword: string;
    newPassword: string;
    keepToken: string;
  }): PublicUser {
    const userWithSecret = this.db.getUserByUsernameWithSecret(input.user.username);
    if (!userWithSecret || userWithSecret.id !== input.user.id) {
      throw new Error("用户不存在");
    }
    if (!verifyPassword(input.currentPassword, userWithSecret.salt, userWithSecret.passwordHash)) {
      throw new Error("当前密码错误");
    }
    if (input.newPassword.length < 8) throw new Error("新密码至少 8 位");
    if (input.newPassword === input.currentPassword) throw new Error("新密码不能与当前密码相同");
    const salt = randomBytes(16).toString("hex");
    const updated = this.db.updateUserPassword(input.user.id, hashPassword(input.newPassword, salt), salt);
    if (!updated) throw new Error("密码更新失败");
    this.db.deleteOtherSessions(input.user.id, input.keepToken);
    this.audit(updated, "auth.password_change", "user", updated.id);
    return updated;
  }

  hasPermission(user: PublicUser | null | undefined, permission: Permission): boolean {
    if (!user) return false;
    return ROLE_PERMISSIONS[user.role].includes(permission);
  }

  canAccessWorkspace(user: PublicUser | null | undefined, workspace?: string): boolean {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (!workspace || workspace === "all") return user.allowedWorkspaces.length === 0;
    return user.allowedWorkspaces.length === 0 || user.allowedWorkspaces.includes(workspace);
  }

  filterReadableWorkspaces(user: PublicUser, workspaces: Array<{ name: string }>) {
    if (user.role === "admin" || user.allowedWorkspaces.length === 0) return workspaces;
    return workspaces.filter((workspace) => user.allowedWorkspaces.includes(workspace.name));
  }

  requirePermission(user: PublicUser | null | undefined, permission: Permission): asserts user is PublicUser {
    if (!this.hasPermission(user, permission)) {
      throw new Error(`权限不足，需要 ${permission} 权限`);
    }
  }

  audit(
    user: PublicUser | null,
    action: string,
    resourceType: string,
    resourceId = "",
    detail: Record<string, unknown> = {},
  ) {
    return this.db.createAuditLog({
      id: newId(),
      userId: user?.id ?? "",
      username: user?.username ?? "",
      action,
      resourceType,
      resourceId,
      detail,
    });
  }

  listAuditLogs(actor: PublicUser, limit = 100) {
    this.requirePermission(actor, "admin");
    return this.db.listAuditLogs(limit);
  }
}

export function parseBearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}
