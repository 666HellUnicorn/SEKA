import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

const tempDir = mkdtempSync(join(tmpdir(), "seka-api-"));
process.env.SEKA_DATA_DIR = tempDir;
process.env.SEKA_DB_PATH = join(tempDir, "seka.db");
process.env.SEKA_UPLOAD_DIR = join(tempDir, "uploads");
process.env.SEKA_HOST = "127.0.0.1";
process.env.SEKA_PORT = "0";

const { run } = await import("../src/server/server.ts");

interface ApiResponse<T> {
  status: number;
  data: T;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    if (server.listening) {
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
      return;
    }
    server.once("listening", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) throw new Error("无法读取测试服务端口");
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function request<T>(baseUrl: string, path: string, options: RequestInit = {}, token = ""): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const server = run("127.0.0.1", 0);

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await request<{ status: string }>(baseUrl, "/api/health");
  assert(health.status === 200 && health.data.status === "ok", "健康检查失败");

  const unauthorized = await request<{ error: string }>(baseUrl, "/api/documents");
  assert(unauthorized.status === 401, "未登录访问文档列表应返回 401");

  const login = await request<{ token: string; user: { role: string } }>(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert(login.status === 200 && login.data.token, "管理员登录失败");
  assert(login.data.user.role === "admin", "管理员角色异常");
  const adminToken = login.data.token;

  const form = new FormData();
  form.set("title", "API 集成测试文档");
  form.set("workspace", "api");
  form.set("tags", "api,test");
  form.set("description", "通过真实 HTTP multipart 上传的测试文档");
  form.set(
    "file",
    new Blob(
      [
        [
          "# API 集成测试文档",
          "",
          "SEKA 支持通过 HTTP API 上传文档、解析切块、检索问答和返回引用来源。",
          "这个测试验证真实全栈接口可以工作。",
        ].join("\n"),
      ],
      { type: "text/markdown" },
    ),
    "api-test.md",
  );

  const upload = await request<{ document: { id: string; chunkCount: number; workspace: string } }>(
    baseUrl,
    "/api/documents",
    { method: "POST", body: form },
    adminToken,
  );
  assert(upload.status === 201, `上传文档失败：${JSON.stringify(upload.data)}`);
  assert(upload.data.document.chunkCount > 0, "上传文档未生成 chunk");
  assert(upload.data.document.workspace === "api", "上传文档 workspace 异常");
  const documentId = upload.data.document.id;

  const detail = await request<{ document: { id: string } }>(baseUrl, `/api/documents/${documentId}`, {}, adminToken);
  assert(detail.status === 200 && detail.data.document.id === documentId, "文档详情接口异常");

  const metadata = await request<{
    document: { id: string; title: string; workspace: string; tags: string[]; description: string };
  }>(
    baseUrl,
    `/api/documents/${documentId}/metadata`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "API 集成测试文档 - 已更新",
        workspace: "api-updated",
        tags: "api,test,updated",
        description: "元数据更新后的说明",
      }),
    },
    adminToken,
  );
  assert(metadata.status === 200, "文档元数据更新失败");
  assert(metadata.data.document.workspace === "api-updated", "文档 workspace 更新异常");
  assert(metadata.data.document.tags.includes("updated"), "文档 tags 更新异常");

  const chunks = await request<{ chunks: unknown[] }>(baseUrl, `/api/documents/${documentId}/chunks`, {}, adminToken);
  assert(chunks.status === 200 && chunks.data.chunks.length > 0, "文档 chunk 接口异常");

  const query = await request<{ answer: string; sources: unknown[] }>(
    baseUrl,
    "/api/query",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "SEKA 支持哪些 API 能力？", workspace: "api-updated", topK: 5 }),
    },
    adminToken,
  );
  assert(query.status === 200 && query.data.sources.length > 0, "问答接口没有返回来源");

  const search = await request<{ results: unknown[] }>(
    baseUrl,
    "/api/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "HTTP API 上传", workspace: "api-updated" }),
    },
    adminToken,
  );
  assert(search.status === 200 && search.data.results.length > 0, "搜索接口没有结果");

  const stats = await request<{ stats: { documentCount: number; chunkCount: number } }>(baseUrl, "/api/stats", {}, adminToken);
  assert(stats.status === 200 && stats.data.stats.documentCount >= 1, "统计接口异常");
  assert(stats.data.stats.chunkCount >= 1, "统计接口 chunk 数异常");

  const settings = await request<{ settings: { dbPath: string; allowedExtensions: string[] } }>(
    baseUrl,
    "/api/settings",
    {},
    adminToken,
  );
  assert(settings.status === 200 && settings.data.settings.dbPath === process.env.SEKA_DB_PATH, "设置接口 DB 路径异常");
  assert(settings.data.settings.allowedExtensions.includes(".md"), "设置接口支持格式异常");

  const exportResponse = await fetch(`${baseUrl}/api/export/markdown?workspace=api-updated`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const markdown = await exportResponse.text();
  assert(exportResponse.status === 200, "Markdown 导出接口失败");
  assert(markdown.includes("# SEKA 知识库报告") && markdown.includes("API 集成测试文档 - 已更新"), "Markdown 导出内容异常");

  const createViewer = await request<{
    user: { id: string; username: string; role: string; isActive: boolean; allowedWorkspaces: string[] };
  }>(
    baseUrl,
    "/api/users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "viewer-api",
        password: "viewer123",
        role: "viewer",
        allowedWorkspaces: "api-updated",
      }),
    },
    adminToken,
  );
  assert(createViewer.status === 201 && createViewer.data.user.role === "viewer", "创建 viewer 失败");
  assert(createViewer.data.user.isActive, "新用户默认应启用");
  assert(createViewer.data.user.allowedWorkspaces.includes("api-updated"), "viewer workspace 授权创建失败");

  const viewerLogin = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "viewer-api", password: "viewer123" }),
  });
  assert(viewerLogin.status === 200 && viewerLogin.data.token, "viewer 登录失败");

  const viewerDocs = await request<{ documents: Array<{ workspace: string }> }>(baseUrl, "/api/documents", {}, viewerLogin.data.token);
  assert(viewerDocs.status === 200 && viewerDocs.data.documents.every((doc) => doc.workspace === "api-updated"), "viewer 文档列表应按 workspace 过滤");

  const viewerStats = await request<{ stats: { documentCount: number; workspaceCount: number; userCount: number; auditLogCount: number } }>(
    baseUrl,
    "/api/stats",
    {},
    viewerLogin.data.token,
  );
  assert(viewerStats.status === 200, "viewer 应可查看授权范围统计");
  assert(viewerStats.data.stats.documentCount === 1, "viewer 统计应限制在授权 workspace 内");
  assert(viewerStats.data.stats.workspaceCount === 1, "viewer workspace 统计应限制在授权 workspace 内");
  assert(viewerStats.data.stats.userCount === 0 && viewerStats.data.stats.auditLogCount === 0, "viewer 统计不应泄露用户和审计总量");

  const viewerAllowedQuery = await request<{ sources: unknown[] }>(
    baseUrl,
    "/api/query",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "SEKA 支持哪些 API 能力？", workspace: "api-updated", topK: 3 }),
    },
    viewerLogin.data.token,
  );
  assert(viewerAllowedQuery.status === 200, "viewer 应可查询授权 workspace");

  const viewerDeniedQuery = await request<{ error: string }>(
    baseUrl,
    "/api/query",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "SEKA 支持哪些 API 能力？", workspace: "secret", topK: 3 }),
    },
    viewerLogin.data.token,
  );
  assert(viewerDeniedQuery.status === 403, "viewer 不应查询未授权 workspace");

  const viewerDeniedExport = await fetch(`${baseUrl}/api/export/markdown?workspace=all`, {
    headers: { Authorization: `Bearer ${viewerLogin.data.token}` },
  });
  assert(viewerDeniedExport.status === 403, "viewer 不应导出 all workspace");

  const updateViewerWorkspaces = await request<{ user: { allowedWorkspaces: string[] } }>(
    baseUrl,
    `/api/users/${createViewer.data.user.id}/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedWorkspaces: "api-updated,company" }),
    },
    adminToken,
  );
  assert(updateViewerWorkspaces.status === 200, "更新 viewer workspace 授权失败");
  assert(updateViewerWorkspaces.data.user.allowedWorkspaces.includes("company"), "viewer workspace 授权未保存");

  const viewerUpload = await request<{ error: string }>(baseUrl, "/api/documents", { method: "POST", body: new FormData() }, viewerLogin.data.token);
  assert(viewerUpload.status === 403, "viewer 上传应被拒绝");

  const disableViewer = await request<{ user: { isActive: boolean } }>(
    baseUrl,
    `/api/users/${createViewer.data.user.id}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    },
    adminToken,
  );
  assert(disableViewer.status === 200 && !disableViewer.data.user.isActive, "禁用 viewer 失败");
  const disabledViewerLogin = await request<{ error: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "viewer-api", password: "viewer123" }),
  });
  assert(disabledViewerLogin.status === 401, "禁用 viewer 不应登录成功");
  const enableViewer = await request<{ user: { isActive: boolean } }>(
    baseUrl,
    `/api/users/${createViewer.data.user.id}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    },
    adminToken,
  );
  assert(enableViewer.status === 200 && enableViewer.data.user.isActive, "启用 viewer 失败");

  const changePassword = await request<{ user: { username: string } }>(
    baseUrl,
    "/api/auth/change-password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "admin123", newPassword: "admin12345" }),
    },
    adminToken,
  );
  assert(changePassword.status === 200 && changePassword.data.user.username === "admin", "改密接口失败");

  const oldLogin = await request<{ error: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert(oldLogin.status === 401, "旧密码不应登录成功");

  const newLogin = await request<{ token: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin12345" }),
  });
  assert(newLogin.status === 200 && newLogin.data.token, "新密码登录失败");

  console.log("SEKA HTTP API integration test passed.");
} finally {
  await close(server).catch(() => undefined);
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
