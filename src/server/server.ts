import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { HOST, PORT, WEB_DIR } from "./config.ts";
import { Database } from "./db.ts";
import { KnowledgeBase } from "./core.ts";
import { KnowledgeAgent } from "./agent.ts";
import { AuthService, parseBearerToken, type Permission } from "./auth.ts";
import { isMultipartFile, parseMultipart } from "./multipart.ts";
import { getRuntimeSettings } from "./settings.ts";
import { assertString, toNumber } from "./utils.ts";

const db = new Database();
const auth = new AuthService(db);
const kb = new KnowledgeBase(db);
const agent = new KnowledgeAgent(kb);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const payload = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.byteLength,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown, status = 400): void {
  sendJson(res, { error: error instanceof Error ? error.message : String(error) }, status);
}

function sendText(res: ServerResponse, content: string, filename: string): void {
  const payload = Buffer.from(content, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Length": payload.byteLength,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(payload);
}

function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  const map = new Map<string, string>([
    [".html", "text/html; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".ts", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
  ]);
  return map.get(ext) ?? "application/octet-stream";
}

function sendStatic(res: ServerResponse, pathname: string): void {
  const path = pathname === "/" ? "/index.html" : pathname;
  const requested = resolve(join(WEB_DIR, path.replace(/^\/+/, "")));
  if (!requested.startsWith(WEB_DIR) || !existsSync(requested)) {
    sendError(res, "页面不存在", 404);
    return;
  }

  if (requested.endsWith(".ts")) {
    const source = readFileSync(requested, "utf8");
    const js = stripTypeScriptTypes(source, {
      mode: "transform",
      sourceMap: false,
      sourceUrl: requested,
    });
    const payload = Buffer.from(js, "utf8");
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": payload.byteLength,
    });
    res.end(payload);
    return;
  }

  res.writeHead(200, { "Content-Type": contentTypeFor(requested) });
  createReadStream(requested).pipe(res);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    sendJson(res, { ok: true });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, { status: "ok", service: "SEKA", runtime: "typescript" });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      try {
        const session = auth.login(assertString(body.username), assertString(body.password));
        sendJson(res, session);
      } catch (error) {
        sendError(res, error, 401);
      }
      return;
    }

    const session = auth.getSession(parseBearerToken(req.headers.authorization));
    const requirePermission = (permission: Permission) => {
      if (!session) {
        sendError(res, "请先登录", 401);
        return false;
      }
      if (!auth.hasPermission(session.user, permission)) {
        sendError(res, `权限不足，需要 ${permission} 权限`, 403);
        return false;
      }
      return true;
    };
    const requireWorkspace = (workspace?: string) => {
      if (!session) {
        sendError(res, "请先登录", 401);
        return false;
      }
      if (!auth.canAccessWorkspace(session.user, workspace)) {
        sendError(res, `无权访问知识空间：${workspace || "all"}`, 403);
        return false;
      }
      return true;
    };
    const scopedWorkspaces = () =>
      session!.user.role === "admin" || session!.user.allowedWorkspaces.length === 0
        ? undefined
        : session!.user.allowedWorkspaces;

    if (pathname.startsWith("/api/") && pathname !== "/api/health") {
      if (!requirePermission("read")) return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      sendJson(res, { user: session!.user, expiresAt: session!.expiresAt });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      auth.logout(parseBearerToken(req.headers.authorization), session!.user);
      sendJson(res, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/change-password") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const user = auth.changeOwnPassword({
        user: session!.user,
        currentPassword: assertString(body.currentPassword ?? body.current_password),
        newPassword: assertString(body.newPassword ?? body.new_password),
        keepToken: parseBearerToken(req.headers.authorization),
      });
      sendJson(res, { user });
      return;
    }

    if (req.method === "GET" && pathname === "/api/users") {
      if (!requirePermission("admin")) return;
      sendJson(res, { users: auth.listUsers() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/users") {
      if (!requirePermission("admin")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, any>;
      const user = auth.createUser(
        {
          username: assertString(body.username),
          password: assertString(body.password),
          displayName: typeof body.displayName === "string" ? body.displayName : undefined,
          role: body.role,
          allowedWorkspaces: body.allowedWorkspaces ?? body.allowed_workspaces ?? body.workspaces,
        },
        session!.user,
      );
      sendJson(res, { user }, 201);
      return;
    }

    const userStatus = pathname.match(/^\/api\/users\/([a-f0-9]+)\/status$/);
    if (req.method === "POST" && userStatus) {
      if (!requirePermission("admin")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const user = auth.setUserActive(userStatus[1], Boolean(body.isActive ?? body.is_active), session!.user);
      sendJson(res, { user });
      return;
    }

    const userWorkspaces = pathname.match(/^\/api\/users\/([a-f0-9]+)\/workspaces$/);
    if (req.method === "POST" && userWorkspaces) {
      if (!requirePermission("admin")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const user = auth.setUserWorkspaces(
        userWorkspaces[1],
        body.allowedWorkspaces ?? body.allowed_workspaces ?? body.workspaces,
        session!.user,
      );
      sendJson(res, { user });
      return;
    }

    if (req.method === "GET" && pathname === "/api/audit-logs") {
      if (!requirePermission("admin")) return;
      sendJson(res, { auditLogs: auth.listAuditLogs(session!.user, toNumber(url.searchParams.get("limit"), 100)) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/documents") {
      const documents = kb.listDocuments().filter((document) => auth.canAccessWorkspace(session!.user, document.workspace));
      sendJson(res, { documents });
      return;
    }

    if (req.method === "GET" && pathname === "/api/workspaces") {
      sendJson(res, { workspaces: auth.filterReadableWorkspaces(session!.user, kb.listWorkspaces()) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/stats") {
      sendJson(res, { stats: kb.getStats(scopedWorkspaces()) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/settings") {
      sendJson(res, { settings: getRuntimeSettings() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/export/markdown") {
      const workspace = url.searchParams.get("workspace") || "all";
      if (!requireWorkspace(workspace)) return;
      const markdown = kb.exportMarkdownReport(workspace);
      auth.audit(session!.user, "knowledge.export_markdown", "export", workspace, { workspace });
      sendText(res, markdown, `seka-report-${workspace}.md`);
      return;
    }

    if (req.method === "GET" && pathname === "/api/feedback") {
      sendJson(res, { feedback: kb.listFeedback(scopedWorkspaces()) });
      return;
    }

    const documentChunks = pathname.match(/^\/api\/documents\/([a-f0-9]+)\/chunks$/);
    if (req.method === "GET" && documentChunks) {
      const document = kb.getDocument(documentChunks[1]);
      if (!document) {
        sendError(res, "文档不存在", 404);
        return;
      }
      if (!requireWorkspace(document.workspace)) return;
      sendJson(res, { chunks: kb.listChunks(documentChunks[1]) });
      return;
    }

    const documentDetail = pathname.match(/^\/api\/documents\/([a-f0-9]+)$/);
    if (req.method === "GET" && documentDetail) {
      const document = kb.getDocument(documentDetail[1]);
      if (!document) {
        sendError(res, "文档不存在", 404);
        return;
      }
      if (!requireWorkspace(document.workspace)) return;
      sendJson(res, { document });
      return;
    }

    const documentMetadata = pathname.match(/^\/api\/documents\/([a-f0-9]+)\/metadata$/);
    if (req.method === "POST" && documentMetadata) {
      if (!requirePermission("write")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, any>;
      const current = kb.getDocument(documentMetadata[1]);
      if (!current) {
        sendError(res, "文档不存在", 404);
        return;
      }
      const nextWorkspace = typeof body.workspace === "string" ? body.workspace : current.workspace;
      if (!requireWorkspace(current.workspace) || !requireWorkspace(nextWorkspace)) return;
      const document = kb.updateDocumentMetadata(documentMetadata[1], {
        title: typeof body.title === "string" ? body.title : undefined,
        workspace: typeof body.workspace === "string" ? body.workspace : undefined,
        tags: Array.isArray(body.tags)
          ? body.tags.map(String)
          : typeof body.tags === "string"
            ? body.tags
            : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
      });
      auth.audit(session!.user, "document.metadata_update", "document", document.id, {
        title: document.title,
        workspace: document.workspace,
        tags: document.tags,
      });
      sendJson(res, { document });
      return;
    }

    if (req.method === "POST" && pathname === "/api/documents") {
      if (!requirePermission("write")) return;
      const body = await readBody(req);
      const fields = parseMultipart(body, req.headers["content-type"] ?? "");
      const file = fields.file;
      if (!isMultipartFile(file)) throw new Error("缺少 file 字段");
      const title = typeof fields.title === "string" ? fields.title : undefined;
      const source = typeof fields.source === "string" ? fields.source : undefined;
      const workspace = typeof fields.workspace === "string" ? fields.workspace : undefined;
      if (!requireWorkspace(workspace || "default")) return;
      const description = typeof fields.description === "string" ? fields.description : undefined;
      const tags =
        typeof fields.tags === "string"
          ? fields.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : undefined;
      const document = await kb.ingestBuffer(file.content, file.filename, {
        title,
        source,
        workspace,
        tags,
        description,
      });
      auth.audit(session!.user, "document.upload", "document", document.id, {
        title: document.title,
        workspace: document.workspace,
        tags: document.tags,
      });
      sendJson(res, { document }, 201);
      return;
    }

    if (req.method === "POST" && pathname === "/api/sources/url") {
      if (!requirePermission("write")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, any>;
      const workspace = typeof body.workspace === "string" ? body.workspace : "default";
      if (!requireWorkspace(workspace)) return;
      const document = await kb.ingestUrl(assertString(body.url), {
        title: typeof body.title === "string" ? body.title : undefined,
        workspace,
        tags: Array.isArray(body.tags)
          ? body.tags.map(String)
          : typeof body.tags === "string"
            ? body.tags.split(",")
            : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
      });
      auth.audit(session!.user, "source.url_ingest", "document", document.id, {
        title: document.title,
        sourceUrl: document.sourceUrl,
        workspace: document.workspace,
      });
      sendJson(res, { document }, 201);
      return;
    }

    if (req.method === "POST" && pathname === "/api/query") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const workspace = typeof body.workspace === "string" ? body.workspace : undefined;
      if (!requireWorkspace(workspace || "all")) return;
      const result = await kb.query(
        assertString(body.question),
        toNumber(body.topK ?? body.top_k, 5),
        workspace,
      );
      auth.audit(session!.user, "knowledge.query", "qa", result.qaId, {
        question: result.question,
        workspace: workspace || "all",
        sourceCount: result.sources.length,
      });
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/agentic-search") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const workspace = typeof body.workspace === "string" ? body.workspace : undefined;
      if (!requireWorkspace(workspace || "all")) return;
      const result = kb.agenticSearch(assertString(body.question), {
        workspace,
        topK: toNumber(body.topK ?? body.top_k, 5),
        maxRounds: toNumber(body.maxRounds ?? body.max_rounds, 3),
      });
      auth.audit(session!.user, "agentic_search.run", "agentic_search", "", {
        question: result.question,
        workspace: result.workspace,
        roundCount: result.rounds.length,
        sourceCount: result.sources.length,
      });
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/search") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const workspace = typeof body.workspace === "string" ? body.workspace : undefined;
      if (!requireWorkspace(workspace || "all")) return;
      const result = kb.search(
        assertString(body.query ?? body.question),
        toNumber(body.topK ?? body.top_k, 8),
        workspace,
      );
      auth.audit(session!.user, "knowledge.search", "search", "", {
        query: result.query,
        workspace: result.workspace,
        resultCount: result.results.length,
      });
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/agent/run") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
      const workspace = typeof body.workspace === "string" ? body.workspace : undefined;
      if (!requireWorkspace(workspace || "all")) return;
      const result = await agent.run(assertString(body.task), {
        workspace,
        topK: toNumber(body.topK ?? body.top_k, 6),
      });
      auth.audit(session!.user, "agent.run", "agent_run", result.runId, {
        task: result.task,
        intent: result.intent,
        workspace: result.workspace,
        toolCallCount: result.toolCalls.length,
      });
      sendJson(res, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/feedback") {
      if (!requirePermission("write")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, any>;
      const feedback = await kb.submitFeedback({
        question: assertString(body.question),
        answer: assertString(body.answer),
        feedbackType: body.feedbackType ?? body.feedback_type,
        comment: assertString(body.comment),
        qaId: typeof body.qaId === "string" ? body.qaId : body.qa_id,
        retrievedChunks: body.retrievedChunks ?? body.sources ?? [],
      });
      auth.audit(session!.user, "feedback.create", "feedback", feedback.id, {
        feedbackType: feedback.feedbackType,
        qaId: feedback.qaId,
      });
      sendJson(res, { feedback }, 201);
      return;
    }

    const feedbackResolve = pathname.match(/^\/api\/feedback\/([a-f0-9]+)\/resolve$/);
    if (req.method === "POST" && feedbackResolve) {
      if (!requirePermission("write")) return;
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, any>;
      const feedback = await kb.resolveFeedback({
        feedbackId: feedbackResolve[1],
        resolution: assertString(body.resolution),
        resolvedBy: session!.user.username,
        saveAsKnowledge: Boolean(body.saveAsKnowledge ?? body.save_as_knowledge),
      });
      auth.audit(session!.user, "feedback.resolve", "feedback", feedback.id, {
        status: feedback.status,
        savedDocumentId: feedback.savedDocumentId,
      });
      sendJson(res, { feedback });
      return;
    }

    const reindex = pathname.match(/^\/api\/documents\/([a-f0-9]+)\/reindex$/);
    if (req.method === "POST" && reindex) {
      if (!requirePermission("write")) return;
      const current = kb.getDocument(reindex[1]);
      if (!current) {
        sendError(res, "文档不存在", 404);
        return;
      }
      if (!requireWorkspace(current.workspace)) return;
      const document = await kb.reindexDocument(reindex[1]);
      auth.audit(session!.user, "document.reindex", "document", document.id, { title: document.title });
      sendJson(res, { document });
      return;
    }

    if (req.method === "DELETE" && documentDetail) {
      if (!requirePermission("write")) return;
      const current = kb.getDocument(documentDetail[1]);
      if (!current) {
        sendError(res, "文档不存在", 404);
        return;
      }
      if (!requireWorkspace(current.workspace)) return;
      const deleted = kb.deleteDocument(documentDetail[1]);
      if (!deleted) {
        sendError(res, "文档不存在", 404);
        return;
      }
      auth.audit(session!.user, "document.delete", "document", documentDetail[1]);
      sendJson(res, { deleted: true });
      return;
    }

    if (req.method === "GET") {
      sendStatic(res, pathname);
      return;
    }

    sendError(res, "接口不存在", 404);
  } catch (error) {
    sendError(res, error, 500);
  }
}

export function run(host = HOST, port = PORT): Server {
  const server = createServer((req, res) => void handleRequest(req, res));
  server.once("close", () => kb.close());
  server.listen(port, host, () => {
    console.log(`SEKA TypeScript server is running at http://${host}:${port}`);
    console.log("Press Ctrl+C to stop.");
  });
  return server;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);

if (executedPath && resolve(modulePath) === resolve(executedPath)) {
  run();
}
