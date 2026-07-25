import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "seka-ts-"));
process.env.SEKA_DATA_DIR = tempDir;
process.env.SEKA_DB_PATH = join(tempDir, "seka.db");
process.env.SEKA_UPLOAD_DIR = join(tempDir, "uploads");

const { KnowledgeBase } = await import("../src/server/core.ts");
const { Database } = await import("../src/server/db.ts");
const { KnowledgeAgent } = await import("../src/server/agent.ts");
const { AuthService } = await import("../src/server/auth.ts");
const { getRuntimeSettings } = await import("../src/server/settings.ts");

try {
  const db = new Database(process.env.SEKA_DB_PATH);
  const auth = new AuthService(db);
  const session = auth.login("admin", "admin123");
  if (session.user.role !== "admin") throw new Error("默认管理员登录失败");
  const viewer = auth.createUser(
    { username: "viewer", password: "viewer123", displayName: "Viewer", role: "viewer" },
    session.user,
  );
  if (!auth.hasPermission(viewer, "read")) throw new Error("viewer 应该有 read 权限");
  if (auth.hasPermission(viewer, "write")) throw new Error("viewer 不应该有 write 权限");
  const disabledViewer = auth.setUserActive(viewer.id, false, session.user);
  if (disabledViewer.isActive) throw new Error("viewer 应该已被禁用");
  try {
    auth.login("viewer", "viewer123");
    throw new Error("禁用用户不应登录成功");
  } catch (error) {
    if (!String(error).includes("用户已被禁用")) throw error;
  }
  const enabledViewer = auth.setUserActive(viewer.id, true, session.user);
  if (!enabledViewer.isActive) throw new Error("viewer 应该已被启用");
  const scopedViewer = auth.setUserWorkspaces(viewer.id, "resume,company", session.user);
  if (!scopedViewer.allowedWorkspaces.includes("resume") || auth.canAccessWorkspace(scopedViewer, "secret")) {
    throw new Error("viewer workspace 授权异常");
  }
  if (!auth.canAccessWorkspace(scopedViewer, "resume")) throw new Error("viewer 应该可访问 resume");
  if (auth.canAccessWorkspace(scopedViewer, "all")) throw new Error("受限 viewer 不应访问 all workspace");
  try {
    auth.createUser({ username: "bad", password: "bad123", role: "owner" }, session.user);
    throw new Error("非法角色不应创建成功");
  } catch (error) {
    if (!String(error).includes("角色必须")) throw error;
  }
  const updatedAdmin = auth.changeOwnPassword({
    user: session.user,
    currentPassword: "admin123",
    newPassword: "admin12345",
    keepToken: session.token,
  });
  if (updatedAdmin.id !== session.user.id) throw new Error("改密返回用户异常");
  try {
    auth.login("admin", "admin123");
    throw new Error("旧密码不应继续登录成功");
  } catch (error) {
    if (!String(error).includes("用户名或密码错误")) throw error;
  }
  const newSession = auth.login("admin", "admin12345");
  if (newSession.user.role !== "admin") throw new Error("新密码登录失败");
  const settings = getRuntimeSettings();
  if (!settings.allowedExtensions.includes(".md")) throw new Error("运行设置缺少支持格式");
  if (settings.dbPath !== process.env.SEKA_DB_PATH) throw new Error("运行设置 DB 路径异常");

  const kb = new KnowledgeBase(db);
  const doc = await kb.ingestBuffer(
    Buffer.from(
      [
        "# SEKA 项目说明",
        "",
        "SEKA 是一个本地可部署的个人和企业知识库 Agent。",
        "它支持文档解析、混合检索、RAG 问答、引用来源和用户反馈迭代。",
        "",
        "简历亮点包括：本地私有部署、答案可溯源、知识可持续更新。",
      ].join("\n"),
      "utf8",
    ),
    "seka.md",
    { title: "SEKA 项目说明", workspace: "resume", tags: ["RAG", "简历"], description: "简历项目测试文档" },
  );

  if (doc.status !== "ready") throw new Error(`文档状态异常：${doc.status}`);
  if (doc.chunkCount <= 0) throw new Error("文档未生成 chunks");

  const workspaces = kb.listWorkspaces();
  if (!workspaces.some((workspace: any) => workspace.name === "resume")) {
    throw new Error("知识空间统计缺少 resume");
  }
  const initialStats = kb.getStats();
  if (initialStats.documentCount !== 1) throw new Error("统计接口文档数异常");
  if (initialStats.chunkCount < doc.chunkCount) throw new Error("统计接口 chunk 数异常");
  if (initialStats.workspaceCount !== 1) throw new Error("统计接口 workspace 数异常");

  const result = await kb.query("SEKA 的简历亮点是什么？", 5, "resume");
  if (result.sources.length === 0) throw new Error("问答没有返回引用来源");
  if (!/简历|本地|溯源/.test(result.answer)) {
    throw new Error(`回答内容不符合预期：${result.answer}`);
  }

  const search = kb.search("简历亮点", 5, "resume");
  if (search.results.length === 0) throw new Error("知识检索没有返回结果");
  if (search.workspace !== "resume") throw new Error("知识检索 workspace 异常");

  const agenticSearch = kb.agenticSearch("这个项目的本地部署和引用来源亮点是什么？", {
    workspace: "resume",
    topK: 2,
    maxRounds: 2,
  });
  if (agenticSearch.sources.length === 0) throw new Error("Agentic Search 没有返回引用来源");
  if (agenticSearch.sources.length > 2 || agenticSearch.rounds.length > 2) throw new Error("Agentic Search topK/maxRounds 未生效");
  if (!agenticSearch.toolCalls.some((call) => call.toolName === "grep.agentic_search")) {
    throw new Error("Agentic Search 未记录 grep 工具调用");
  }
  const emptyAgenticSearch = kb.agenticSearch("zzzz_no_match_identifier", { workspace: "resume", topK: 2, maxRounds: 3 });
  if (emptyAgenticSearch.sources.length !== 0 || !emptyAgenticSearch.answer.includes("没有找到足够证据")) {
    throw new Error("Agentic Search 空结果处理异常");
  }

  const feedback = await kb.submitFeedback({
    question: result.question,
    answer: result.answer,
    feedbackType: "save",
    comment: "这条问答适合作为项目展示样例。",
    qaId: result.qaId,
    retrievedChunks: result.sources,
  });
  if (!feedback.savedDocument) throw new Error("保存为知识失败");
  if (kb.listDocuments().length !== 2) throw new Error("反馈知识未进入文档库");

  const wrongFeedback = await kb.submitFeedback({
    question: "SEKA 是否支持反馈修正？",
    answer: "暂不支持。",
    feedbackType: "wrong",
    comment: "实际上需要支持反馈修正闭环。",
  });
  const resolvedFeedback = await kb.resolveFeedback({
    feedbackId: wrongFeedback.id,
    resolution: "SEKA 支持将错误反馈标记为已修正，并可保存为修正知识。",
    resolvedBy: session.user.username,
    saveAsKnowledge: true,
  });
  if (resolvedFeedback.status !== "resolved") throw new Error("反馈没有被标记为 resolved");
  if (!resolvedFeedback.savedDocumentId) throw new Error("修正反馈没有保存为知识");

  const agent = new KnowledgeAgent(kb);
  const agentRun = await agent.run("分析当前知识库还缺少哪些内容", {
    workspace: "resume",
    topK: 5,
  });
  if (agentRun.intent !== "gap_analysis") throw new Error(`Agent 意图识别异常：${agentRun.intent}`);
  if (agentRun.toolCalls.length === 0) throw new Error("Agent 未记录工具调用");
  if (!agentRun.answer.includes("知识缺口分析")) throw new Error("Agent 缺口分析回答异常");
  const report = kb.exportMarkdownReport("resume");
  if (!report.includes("# SEKA 知识库报告") || !report.includes("SEKA 项目说明")) {
    throw new Error("Markdown 报告导出异常");
  }

  auth.audit(session.user, "test.audit", "smoke", "smoke-test");
  if (auth.listAuditLogs(session.user, 10).length === 0) throw new Error("审计日志记录失败");
  const finalStats = kb.getStats();
  if (finalStats.feedbackOpenCount < 1 || finalStats.feedbackResolvedCount < 1) {
    throw new Error("统计接口反馈状态异常");
  }
  if (finalStats.qaCount < 1 || finalStats.auditLogCount < 1 || finalStats.userCount < 2) {
    throw new Error("统计接口历史数据异常");
  }

  kb.close();
  console.log("SEKA TypeScript smoke test passed.");
} finally {
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`临时目录清理失败，可手动删除：${tempDir}`, error);
  }
}
