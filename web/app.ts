import type {
  AgentRunResult,
  AgenticSearchResult,
  AuditLogItem,
  CitationSource,
  FeedbackItem,
  KnowledgeChunk,
  KnowledgeStats,
  PublicUser,
  KnowledgeDocument,
  QueryResult,
  RuntimeSettings,
  SearchResult,
  WorkspaceSummary,
} from "../src/shared/types.ts";

interface UiState {
  lastAnswer: string;
  lastQuestion: string;
  lastQaId: string | null;
  lastSources: CitationSource[];
  currentWorkspace: string;
  token: string;
  user: PublicUser | null;
}

const state: UiState = {
  lastAnswer: "",
  lastQuestion: "",
  lastQaId: null,
  lastSources: [],
  currentWorkspace: "all",
  token: localStorage.getItem("seka_token") || "",
  user: null,
};

function $<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element as T;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  const finalOptions = { ...options, headers };
  const finalResponse = await fetch(path, finalOptions);
  const data = (await finalResponse.json().catch(() => ({}))) as any;
  if (!finalResponse.ok) throw new Error(data.error || `请求失败：${finalResponse.status}`);
  return data as T;
}

function renderAuthState(): void {
  const authPanel = $("#auth-panel");
  const userPanel = $("#user-panel");
  const userManagementPanel = $("#user-management-panel");
  const currentUser = $("#current-user");
  if (!state.user) {
    authPanel.classList.remove("hidden");
    userPanel.classList.add("hidden");
    userManagementPanel.classList.add("hidden");
    currentUser.textContent = "未登录";
    return;
  }
  authPanel.classList.add("hidden");
  userPanel.classList.remove("hidden");
  if (state.user.role === "admin") {
    userManagementPanel.classList.remove("hidden");
  } else {
    userManagementPanel.classList.add("hidden");
  }
  currentUser.innerHTML = `
    <strong>${escapeHtml(state.user.displayName)}</strong><br />
    用户名：${escapeHtml(state.user.username)}<br />
    角色：${escapeHtml(state.user.role)}
  `;
}

function renderSettings(settings: RuntimeSettings): void {
  const container = $("#settings-list");
  container.className = "settings-list";
  container.innerHTML = `
    <div><strong>服务</strong><span>${escapeHtml(settings.host)}:${settings.port}</span></div>
    <div><strong>Node</strong><span>${escapeHtml(settings.nodeVersion)}</span></div>
    <div><strong>数据目录</strong><span>${escapeHtml(settings.dataDir)}</span></div>
    <div><strong>数据库</strong><span>${escapeHtml(settings.dbPath)}</span></div>
    <div><strong>上传目录</strong><span>${escapeHtml(settings.uploadDir)}</span></div>
    <div><strong>切块</strong><span>${settings.chunkSize} / overlap ${settings.chunkOverlap}</span></div>
    <div><strong>最大上传</strong><span>${formatBytes(settings.maxUploadBytes)}</span></div>
    <div><strong>OCR</strong><span>${escapeHtml(settings.ocrLang)}</span></div>
    <div><strong>LLM</strong><span>${settings.llmConfigured ? "已配置" : "本地提取式"} · ${escapeHtml(settings.llmModel)}</span></div>
    <div><strong>支持格式</strong><span>${escapeHtml(settings.allowedExtensions.join(", "))}</span></div>
  `;
  const warning = $("#security-warning");
  if (settings.usingDefaultAdminPassword) {
    warning.className = "warning-box";
    warning.textContent = "安全提示：当前可能仍在使用默认管理员密码。请改密，或通过 SEKA_ADMIN_PASSWORD 设置强密码。";
  } else {
    warning.className = "success-box";
    warning.textContent = "管理员默认密码已通过环境变量覆盖。";
  }
}

async function loadSettings(): Promise<void> {
  const container = $("#settings-list");
  if (!state.user) {
    container.className = "settings-list empty";
    container.textContent = "登录后显示运行配置";
    return;
  }
  try {
    const data = await api<{ settings: RuntimeSettings }>("/api/settings");
    renderSettings(data.settings);
  } catch (error) {
    container.className = "settings-list empty";
    container.textContent = `设置加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function login(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = "登录中…";
  try {
    const data = await api<{ token: string; user: PublicUser }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(formData.get("username") || ""),
        password: String(formData.get("password") || ""),
      }),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("seka_token", data.token);
    renderAuthState();
    addMessage("assistant", `已登录：${data.user.displayName}（${data.user.role}）`);
    await refreshAfterAuth();
  } catch (error) {
    addMessage("assistant", `登录失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "登录";
  }
}

async function loadMe(): Promise<void> {
  if (!state.token) {
    renderAuthState();
    return;
  }
  try {
    const data = await api<{ user: PublicUser }>("/api/auth/me");
    state.user = data.user;
  } catch {
    state.token = "";
    state.user = null;
    localStorage.removeItem("seka_token");
  }
  renderAuthState();
}

async function logout(): Promise<void> {
  try {
    if (state.token) {
      await api("/api/auth/logout", { method: "POST" });
    }
  } catch {
    // ignore logout failures and clear local session
  }
  state.token = "";
  state.user = null;
  localStorage.removeItem("seka_token");
  renderAuthState();
}

async function changePassword(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  if (newPassword !== confirmPassword) {
    addMessage("assistant", "两次输入的新密码不一致。");
    return;
  }
  button.disabled = true;
  button.textContent = "更新中…";
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: String(formData.get("currentPassword") || ""),
        newPassword,
      }),
    });
    form.reset();
    addMessage("assistant", "密码已更新，其他会话已失效。");
    await loadSettings();
    await loadAuditLogs();
  } catch (error) {
    addMessage("assistant", `改密失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "更新密码";
  }
}

async function refreshAfterAuth(): Promise<void> {
  await loadStats();
  await loadSettings();
  await loadDocuments();
  await loadWorkspaces();
  await loadUsers();
  await loadAuditLogs();
  await loadFeedback();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addMessage(role: "user" | "assistant", content: string, withFeedback = false): void {
  const messages = $("#messages");
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.innerHTML = `
    <div class="avatar">${role === "user" ? "你" : "AI"}</div>
    <div>
      <div class="bubble">${escapeHtml(content)}</div>
      ${
        withFeedback
          ? `<div class="feedback-actions">
              <button class="ghost-btn" data-feedback="correct">回答正确</button>
              <button class="danger-btn" data-feedback="wrong">回答错误</button>
              <button data-feedback="save">保存为知识</button>
            </div>`
          : ""
      }
    </div>
  `;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderSources(sources: CitationSource[]): void {
  const container = $("#sources-list");
  if (!sources.length) {
    container.className = "sources-list empty";
    container.textContent = "暂无来源";
    return;
  }
  container.className = "sources-list";
  container.innerHTML = sources
    .map(
      (source) => `
      <article class="source-item">
        <h3>[${source.citationIndex}] ${escapeHtml(
          source.documentTitle || source.documentFilename || "未知文档",
        )}</h3>
        <div class="source-meta">
          页码：${escapeHtml(source.pageNumber || "N/A")} ·
          分数：${escapeHtml(source.score || "0")} ·
          关键词：${escapeHtml(source.keywordScore || "0")} ·
          向量：${escapeHtml(source.vectorScore || "0")}
        </div>
        <p>${escapeHtml(source.snippet)}</p>
      </article>
    `,
    )
    .join("");
}

function renderSearchResult(result: SearchResult): void {
  const container = $("#search-result");
  if (!result.results.length) {
    container.className = "sources-list empty";
    container.textContent = "没有命中片段";
    return;
  }
  container.className = "sources-list";
  container.innerHTML = result.results
    .map(
      (source) => `
      <article class="source-item">
        <h3>[${source.citationIndex}] ${escapeHtml(source.documentTitle || source.documentFilename || "未知文档")}</h3>
        <div class="source-meta">
          空间：${escapeHtml(result.workspace)} · 页码：${escapeHtml(source.pageNumber || "N/A")} ·
          分数：${escapeHtml(source.score)} · 关键词：${escapeHtml(source.keywordScore)} · 向量：${escapeHtml(source.vectorScore)}
        </div>
        <p>${escapeHtml(source.snippet)}</p>
      </article>
    `,
    )
    .join("");
}

function renderAgentResult(result: AgentRunResult): void {
  const container = $("#agent-result");
  container.className = "agent-result";
  container.innerHTML = `
    <div class="agent-answer">
      <strong>Intent：</strong>${escapeHtml(result.intent)}
      <span class="source-meta"> · Workspace：${escapeHtml(result.workspace)} · Run：${escapeHtml(result.runId)}</span>

${escapeHtml(result.answer)}
    </div>
    <div>
      <h3>工具调用</h3>
      ${
        result.toolCalls.length
          ? result.toolCalls
              .map(
                (call) => `
                <div class="tool-call">
                  <strong>${escapeHtml(call.toolName)}</strong>
                  <span class="source-meta"> · ${escapeHtml(call.status)} · ${escapeHtml(call.startedAt)}</span>
                  <p>${escapeHtml(call.outputSummary)}</p>
                </div>
              `,
              )
              .join("")
          : `<p class="empty">无工具调用</p>`
      }
    </div>
  `;
}

function renderAgenticSearchResult(result: AgenticSearchResult): void {
  const container = $("#agentic-search-result");
  container.className = "agent-result";
  const roundsHtml = result.rounds
    .map(
      (round) => `
        <article class="agentic-round">
          <div class="round-header">
            <strong>Round ${round.round} · ${escapeHtml(round.strategy)}</strong>
            <span class="source-meta">命中 ${round.hitCount} 个 chunk</span>
          </div>
          <div class="tag-row">
            ${round.queries
              .map(
                (query) => `
                  <span class="tag" title="${escapeHtml(query.reason)}">${escapeHtml(query.query)}</span>
                `,
              )
              .join("")}
          </div>
          ${
            round.hits.length
              ? round.hits
                  .slice(0, 3)
                  .map(
                    (hit) => `
                      <div class="round-hit">
                        <strong>[${hit.citationIndex}] ${escapeHtml(hit.documentTitle || hit.documentFilename || "未知文档")}</strong>
                        <span class="source-meta"> · score ${escapeHtml(hit.score)} · ${escapeHtml(hit.sectionTitle || "未命名章节")}</span>
                        <p>${escapeHtml(hit.snippet.slice(0, 260))}</p>
                      </div>
                    `,
                  )
                  .join("")
              : `<p class="empty">本轮没有命中。建议补充关键词或上传更多文档。</p>`
          }
        </article>
      `,
    )
    .join("");
  const toolCallsHtml = result.toolCalls
    .map(
      (call) => `
        <div class="tool-call">
          <strong>${escapeHtml(call.toolName)}</strong>
          <span class="source-meta"> · ${escapeHtml(call.status)} · ${escapeHtml(call.startedAt)}</span>
          <p>${escapeHtml(call.outputSummary)}</p>
        </div>
      `,
    )
    .join("");
  container.innerHTML = `
    <div class="agent-answer">
      <strong>Workspace：</strong>${escapeHtml(result.workspace)}
      <span class="source-meta"> · ${escapeHtml(result.createdAt)} · Sources ${result.sources.length}</span>

${escapeHtml(result.answer)}
    </div>
    <div>
      <h3>搜索轨迹</h3>
      ${roundsHtml || `<p class="empty">暂无搜索轮次</p>`}
    </div>
    <div>
      <h3>引用来源</h3>
      ${
        result.sources.length
          ? result.sources
              .map(
                (source) => `
                  <article class="source-item">
                    <h3>[${source.citationIndex}] ${escapeHtml(source.documentTitle || source.documentFilename || "未知文档")}</h3>
                    <div class="source-meta">
                      页码：${escapeHtml(source.pageNumber || "N/A")} ·
                      分数：${escapeHtml(source.score)} · 关键词：${escapeHtml(source.keywordScore)} · grep-only
                    </div>
                    <p>${escapeHtml(source.snippet)}</p>
                  </article>
                `,
              )
              .join("")
          : `<p class="empty">建议补充关键词或上传更多文档。</p>`
      }
    </div>
    <div>
      <h3>工具调用</h3>
      ${toolCallsHtml || `<p class="empty">无工具调用</p>`}
    </div>
  `;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function loadStats(): Promise<void> {
  const container = $("#stats-grid");
  if (!state.user) {
    container.className = "stats-grid empty";
    container.textContent = "登录后显示知识库概览";
    return;
  }
  try {
    const data = await api<{ stats: KnowledgeStats }>("/api/stats");
    const stats = data.stats;
    container.className = "stats-grid";
    container.innerHTML = [
      ["文档", stats.documentCount, `${stats.readyDocumentCount} ready / ${stats.errorDocumentCount} error`],
      ["Chunks", stats.chunkCount, "可检索知识片段"],
      ["空间", stats.workspaceCount, "workspace 隔离"],
      ["反馈", stats.feedbackOpenCount, `${stats.feedbackResolvedCount} 已修正`],
      ["问答", stats.qaCount, "历史 QA 记录"],
      ["审计", stats.auditLogCount, `${stats.userCount} 用户`],
      ["容量", formatBytes(stats.totalSizeBytes), "本地上传文件"],
      ["最新文档", stats.latestDocumentAt || "-", "最近入库时间"],
    ]
      .map(
        ([label, value, hint]) => `
          <article class="stat-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(hint)}</small>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    container.className = "stats-grid empty";
    container.textContent = `统计加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadHealth(): Promise<void> {
  const health = $("#health");
  try {
    const data = await api<{ status: string; runtime: string }>("/api/health");
    health.textContent = data.status === "ok" ? `服务正常 · ${data.runtime}` : "服务异常";
  } catch {
    health.textContent = "连接失败";
    (health as HTMLElement).style.color = "#b42318";
    (health as HTMLElement).style.background = "#fff1f0";
  }
}

async function loadDocuments(): Promise<void> {
  const list = $("#docs-list");
  list.textContent = "加载中…";
  try {
    const data = await api<{ documents: KnowledgeDocument[] }>("/api/documents");
    const docs = data.documents || [];
    if (!docs.length) {
      list.className = "docs-list empty";
      list.textContent = "暂无文档";
      return;
    }
    list.className = "docs-list";
    list.innerHTML = docs
      .map((doc) => {
        const warnings = doc.warnings?.length ? ` · ${doc.warnings.length} 条提示` : "";
        return `
          <article class="doc-item" data-id="${doc.id}">
            <div>
              <h3>${escapeHtml(doc.title)}</h3>
              <p>${escapeHtml(doc.filename)} · ${escapeHtml(doc.fileType)} · ${escapeHtml(
                doc.status,
              )} · ${doc.chunkCount} chunks · 空间：${escapeHtml(doc.workspace)}${warnings}</p>
              ${
                doc.description
                  ? `<p class="doc-description">${escapeHtml(doc.description)}</p>`
                  : ""
              }
              ${
                doc.sourceUrl
                  ? `<p><a href="${escapeHtml(doc.sourceUrl)}" target="_blank" rel="noreferrer">打开来源网页</a></p>`
                  : ""
              }
              ${
                doc.tags?.length
                  ? `<div class="tag-row">${doc.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
                  : ""
              }
            </div>
            <div class="doc-actions">
              <button data-action="detail" class="ghost-btn">详情</button>
              <button data-action="reindex" class="ghost-btn">重建</button>
              <button data-action="delete" class="danger-btn">删除</button>
            </div>
          </article>
        `;
      })
      .join("");
  } catch (error) {
    list.className = "docs-list empty";
    list.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderDocumentDetail(document: KnowledgeDocument, chunks: KnowledgeChunk[]): void {
  const container = $("#document-detail");
  container.className = "document-detail";
  const sourceUrl = document.sourceUrl
    ? `<a href="${escapeHtml(document.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(document.sourceUrl)}</a>`
    : "无";
  container.innerHTML = `
    <div class="panel-title-row">
      <div>
        <h3>${escapeHtml(document.title)}</h3>
        <p class="source-meta">${escapeHtml(document.filename)} · ${escapeHtml(document.fileType)} · ${escapeHtml(document.status)}</p>
      </div>
      <span class="status-pill-small ${document.status === "ready" ? "resolved" : ""}">${escapeHtml(document.workspace)}</span>
    </div>
    <div class="detail-grid">
      <div><strong>来源</strong><span>${escapeHtml(document.source)}</span></div>
      <div><strong>大小</strong><span>${formatBytes(document.sizeBytes)}</span></div>
      <div><strong>Chunks</strong><span>${document.chunkCount}</span></div>
      <div><strong>Parser</strong><span>${escapeHtml(document.parser || "-")}</span></div>
      <div><strong>创建</strong><span>${escapeHtml(document.createdAt)}</span></div>
      <div><strong>更新</strong><span>${escapeHtml(document.updatedAt)}</span></div>
    </div>
    <p><strong>源 URL：</strong>${sourceUrl}</p>
    ${
      document.tags.length
        ? `<div class="tag-row">${document.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
        : ""
    }
    ${document.description ? `<p><strong>说明：</strong>${escapeHtml(document.description)}</p>` : ""}
    <form class="metadata-form" data-document-metadata="${escapeHtml(document.id)}">
      <h3>编辑元数据</h3>
      <input name="title" type="text" value="${escapeHtml(document.title)}" placeholder="文档标题" required />
      <input name="workspace" type="text" value="${escapeHtml(document.workspace)}" placeholder="知识空间" required />
      <input name="tags" type="text" value="${escapeHtml(document.tags.join(", "))}" placeholder="标签，逗号分隔" />
      <textarea name="description" rows="2" placeholder="文档说明">${escapeHtml(document.description)}</textarea>
      <button type="submit">保存元数据</button>
    </form>
    ${document.summary ? `<p><strong>摘要：</strong>${escapeHtml(document.summary)}</p>` : ""}
    ${
      document.warnings.length
        ? `<div class="warning-box"><strong>解析提示</strong>${document.warnings
            .map((warning) => `<p>${escapeHtml(warning)}</p>`)
            .join("")}</div>`
        : ""
    }
    <h3>切块预览</h3>
    <div class="chunk-list">
      ${
        chunks.length
          ? chunks
              .slice(0, 12)
              .map(
                (chunk) => `
                  <article class="chunk-item">
                    <div class="source-meta">#${chunk.chunkIndex + 1} · page ${escapeHtml(chunk.pageNumber || "N/A")} · ${chunk.tokenCount} tokens</div>
                    <p>${escapeHtml(chunk.content.slice(0, 900))}</p>
                  </article>
                `,
              )
              .join("")
          : `<p class="empty">暂无切块</p>`
      }
    </div>
  `;
}

async function loadDocumentDetail(id: string): Promise<void> {
  const container = $("#document-detail");
  container.className = "document-detail empty";
  container.textContent = "详情加载中…";
  try {
    const [documentData, chunksData] = await Promise.all([
      api<{ document: KnowledgeDocument }>(`/api/documents/${id}`),
      api<{ chunks: KnowledgeChunk[] }>(`/api/documents/${id}/chunks`),
    ]);
    renderDocumentDetail(documentData.document, chunksData.chunks);
  } catch (error) {
    container.className = "document-detail empty";
    container.textContent = `详情加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function updateDocumentMetadata(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = (event.target as Element).closest("form[data-document-metadata]") as HTMLFormElement | null;
  if (!form) return;
  const documentId = form.dataset.documentMetadata;
  if (!documentId) return;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    await api(`/api/documents/${documentId}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: String(formData.get("title") || ""),
        workspace: String(formData.get("workspace") || "default"),
        tags: String(formData.get("tags") || ""),
        description: String(formData.get("description") || ""),
      }),
    });
    addMessage("assistant", "文档元数据已更新。");
    await loadDocumentDetail(documentId);
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadAuditLogs();
  } catch (error) {
    addMessage("assistant", `元数据更新失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "保存元数据";
  }
}

async function loadWorkspaces(): Promise<void> {
  const select = $("#workspace-select") as HTMLSelectElement;
  const summary = $("#workspace-summary");
  try {
    const data = await api<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
    const previous = select.value || state.currentWorkspace;
    select.innerHTML = `<option value="all">全部空间</option>`;
    for (const workspace of data.workspaces) {
      const option = document.createElement("option");
      option.value = workspace.name;
      option.textContent = `${workspace.name} (${workspace.documentCount} 文档 / ${workspace.chunkCount} chunks)`;
      select.appendChild(option);
    }
    select.value = [...select.options].some((option) => option.value === previous) ? previous : "all";
    state.currentWorkspace = select.value;
    summary.textContent = data.workspaces.length
      ? `已建立 ${data.workspaces.length} 个知识空间`
      : "暂无知识空间";
  } catch (error) {
    summary.textContent = `空间加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadAuditLogs(): Promise<void> {
  const container = $("#audit-list");
  if (!state.user || state.user.role !== "admin") {
    container.className = "sources-list empty";
    container.textContent = "管理员登录后可查看审计日志";
    return;
  }
  try {
    const data = await api<{ auditLogs: AuditLogItem[] }>("/api/audit-logs?limit=50");
    if (!data.auditLogs.length) {
      container.className = "sources-list empty";
      container.textContent = "暂无审计日志";
      return;
    }
    container.className = "sources-list";
    container.innerHTML = data.auditLogs
      .map(
        (item) => `
          <article class="source-item">
            <h3>${escapeHtml(item.action)} <span class="source-meta">· ${escapeHtml(item.username || "system")}</span></h3>
            <div class="source-meta">${escapeHtml(item.resourceType)} / ${escapeHtml(item.resourceId || "-")} · ${escapeHtml(item.createdAt)}</div>
            <p>${escapeHtml(JSON.stringify(item.detail))}</p>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    container.className = "sources-list empty";
    container.textContent = `审计日志加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadUsers(): Promise<void> {
  const container = $("#users-list");
  if (!state.user || state.user.role !== "admin") {
    container.className = "docs-list empty";
    container.textContent = "管理员登录后可查看用户";
    return;
  }
  try {
    const data = await api<{ users: PublicUser[] }>("/api/users");
    if (!data.users.length) {
      container.className = "docs-list empty";
      container.textContent = "暂无用户";
      return;
    }
    container.className = "docs-list";
    container.innerHTML = data.users
      .map(
        (user) => `
          <article class="doc-item" data-user-id="${escapeHtml(user.id)}">
            <h3>
              ${escapeHtml(user.displayName)}
              <span class="role-pill">${escapeHtml(user.role)}</span>
              <span class="status-pill-small ${user.isActive ? "resolved" : ""}">${user.isActive ? "active" : "disabled"}</span>
            </h3>
            <p>用户名：${escapeHtml(user.username)} · 创建：${escapeHtml(user.createdAt)} · 最近登录：${escapeHtml(user.lastLoginAt || "从未")}</p>
            <p>授权空间：${escapeHtml(user.allowedWorkspaces.length ? user.allowedWorkspaces.join(", ") : "全部")}</p>
            <form class="inline-workspace-form" data-user-workspaces="${escapeHtml(user.id)}">
              <input name="allowedWorkspaces" type="text" value="${escapeHtml(user.allowedWorkspaces.join(", "))}" placeholder="授权空间，逗号分隔；留空表示全部" />
              <button type="submit" class="ghost-btn">保存空间</button>
            </form>
            <div class="doc-actions">
              <button
                type="button"
                class="${user.isActive ? "danger-btn" : "ghost-btn"}"
                data-user-active="${user.isActive ? "false" : "true"}"
                ${state.user?.id === user.id ? "disabled" : ""}
              >
                ${user.isActive ? "禁用" : "启用"}
              </button>
            </div>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    container.className = "docs-list empty";
    container.textContent = `用户加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function createUser(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = "创建中…";
  try {
    const data = await api<{ user: PublicUser }>("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(formData.get("username") || ""),
        displayName: String(formData.get("displayName") || ""),
        password: String(formData.get("password") || ""),
        role: String(formData.get("role") || "viewer"),
        allowedWorkspaces: String(formData.get("allowedWorkspaces") || ""),
      }),
    });
    addMessage("assistant", `已创建用户：${data.user.username}（${data.user.role}）`);
    form.reset();
    await loadUsers();
    await loadAuditLogs();
  } catch (error) {
    addMessage("assistant", `创建用户失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "创建用户";
  }
}

async function updateUserWorkspaces(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = (event.target as Element).closest("form[data-user-workspaces]") as HTMLFormElement | null;
  if (!form) return;
  const userId = form.dataset.userWorkspaces;
  if (!userId) return;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    await api(`/api/users/${userId}/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedWorkspaces: String(formData.get("allowedWorkspaces") || "") }),
    });
    addMessage("assistant", "用户授权空间已更新。");
    await loadUsers();
    await loadAuditLogs();
  } catch (error) {
    addMessage("assistant", `授权空间更新失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "保存空间";
  }
}

async function toggleUserStatus(event: MouseEvent): Promise<void> {
  const button = (event.target as Element).closest("button[data-user-active]") as HTMLButtonElement | null;
  if (!button) return;
  const item = button.closest("[data-user-id]") as HTMLElement | null;
  const userId = item?.dataset.userId;
  if (!userId) return;
  const isActive = button.dataset.userActive === "true";
  button.disabled = true;
  button.textContent = isActive ? "启用中…" : "禁用中…";
  try {
    await api(`/api/users/${userId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    addMessage("assistant", isActive ? "用户已启用。" : "用户已禁用。");
    await loadUsers();
    await loadAuditLogs();
    await loadStats();
  } catch (error) {
    addMessage("assistant", `用户状态更新失败：${error instanceof Error ? error.message : String(error)}`);
    await loadUsers();
  }
}

async function loadFeedback(): Promise<void> {
  const container = $("#feedback-list");
  if (!state.user) {
    container.className = "sources-list empty";
    container.textContent = "登录后可查看反馈";
    return;
  }
  try {
    const data = await api<{ feedback: FeedbackItem[] }>("/api/feedback");
    if (!data.feedback.length) {
      container.className = "sources-list empty";
      container.textContent = "暂无反馈";
      return;
    }
    container.className = "sources-list";
    container.innerHTML = data.feedback
      .map(
        (item) => `
          <article class="source-item" data-feedback-id="${escapeHtml(item.id)}">
            <h3>
              ${escapeHtml(item.feedbackType)}
              <span class="status-pill-small ${item.status === "resolved" ? "resolved" : ""}">${escapeHtml(item.status)}</span>
            </h3>
            <div class="source-meta">创建：${escapeHtml(item.createdAt)} · QA：${escapeHtml(item.qaId || "-")}</div>
            <p><strong>问题：</strong>${escapeHtml(item.question)}</p>
            <p><strong>反馈：</strong>${escapeHtml(item.comment || "无")}</p>
            ${
              item.status === "resolved"
                ? `<p><strong>修正：</strong>${escapeHtml(item.resolution)}<br/>处理人：${escapeHtml(item.resolvedBy)} · ${escapeHtml(item.resolvedAt)}</p>`
                : state.user?.role === "viewer"
                  ? `<p class="empty">viewer 只能查看反馈，不能修正。</p>`
                  : `<form class="inline-resolution" data-feedback-resolve="${escapeHtml(item.id)}">
                      <textarea name="resolution" rows="2" placeholder="填写修正结论 / 正确答案" required></textarea>
                      <label><input name="saveAsKnowledge" type="checkbox" checked /> 保存为修正知识</label>
                      <button type="submit">标记已修正</button>
                    </form>`
            }
          </article>
        `,
      )
      .join("");
  } catch (error) {
    container.className = "sources-list empty";
    container.textContent = `反馈加载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function resolveFeedback(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = (event.target as Element).closest("form[data-feedback-resolve]") as HTMLFormElement | null;
  if (!form) return;
  const feedbackId = form.dataset.feedbackResolve;
  if (!feedbackId) return;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = "处理中…";
  try {
    await api(`/api/feedback/${feedbackId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution: String(formData.get("resolution") || ""),
        saveAsKnowledge: formData.get("saveAsKnowledge") === "on",
      }),
    });
    addMessage("assistant", "反馈已标记为已修正。");
    await loadFeedback();
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadAuditLogs();
  } catch (error) {
    addMessage("assistant", `修正失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "标记已修正";
  }
}

async function uploadDocument(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const fileInput = $("#file-input") as HTMLInputElement;
  if (!fileInput.files?.length) return;
  const button = form.querySelector("button")!;
  button.disabled = true;
  button.textContent = "索引中…";
  try {
    const payload = new FormData(form);
    const data = await api<{ document: KnowledgeDocument }>("/api/documents", {
      method: "POST",
      body: payload,
    });
    addMessage("assistant", `已索引文档：${data.document.title}，切块数：${data.document.chunkCount}`);
    form.reset();
    const workspaceInput = form.querySelector('input[name="workspace"]') as HTMLInputElement | null;
    if (workspaceInput) workspaceInput.value = "default";
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadUsers();
    await loadAuditLogs();
    await loadFeedback();
  } catch (error) {
    addMessage("assistant", `上传失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "上传并索引";
  }
}

async function importUrl(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  button.disabled = true;
  button.textContent = "抓取中…";
  try {
    const payload = {
      url: String(formData.get("url") || ""),
      title: String(formData.get("title") || ""),
      workspace: String(formData.get("workspace") || "default"),
      tags: String(formData.get("tags") || ""),
    };
    const data = await api<{ document: KnowledgeDocument }>("/api/sources/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    addMessage("assistant", `已导入网页：${data.document.title}，切块数：${data.document.chunkCount}`);
    form.reset();
    const workspaceInput = form.querySelector('input[name="workspace"]') as HTMLInputElement | null;
    if (workspaceInput) workspaceInput.value = "default";
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadUsers();
    await loadAuditLogs();
    await loadFeedback();
  } catch (error) {
    addMessage("assistant", `网页导入失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "抓取并索引";
  }
}

async function askQuestion(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const questionInput = $("#question-input") as HTMLTextAreaElement;
  const question = questionInput.value.trim();
  if (!question) return;
  const topK = Number(($("#topk-input") as HTMLInputElement).value || 5);
  const button = (event.currentTarget as HTMLFormElement).querySelector("button")!;
  addMessage("user", question);
  questionInput.value = "";
  button.disabled = true;
  button.textContent = "思考中…";
  try {
    const data = await api<QueryResult>("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, topK, workspace: state.currentWorkspace }),
    });
    state.lastQuestion = question;
    state.lastAnswer = data.answer;
    state.lastQaId = data.qaId;
    state.lastSources = data.sources || [];
    addMessage("assistant", data.answer, true);
    renderSources(state.lastSources);
  } catch (error) {
    addMessage("assistant", `问答失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "提问";
  }
}

async function searchKnowledge(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const queryInput = $("#search-input") as HTMLInputElement;
  const query = queryInput.value.trim();
  if (!query) return;
  const topK = Number(($("#search-topk-input") as HTMLInputElement).value || 8);
  const button = (event.currentTarget as HTMLFormElement).querySelector("button")!;
  button.disabled = true;
  button.textContent = "检索中…";
  try {
    const result = await api<SearchResult>("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK, workspace: state.currentWorkspace }),
    });
    renderSearchResult(result);
    renderSources(result.results);
    await loadAuditLogs();
  } catch (error) {
    const container = $("#search-result");
    container.className = "sources-list empty";
    container.textContent = `检索失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = "检索片段";
  }
}

async function runAgenticSearch(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const questionInput = $("#agentic-search-input") as HTMLTextAreaElement;
  const question = questionInput.value.trim();
  if (!question) return;
  const topK = Number(($("#agentic-search-topk-input") as HTMLInputElement).value || 5);
  const maxRounds = Number(($("#agentic-search-rounds-input") as HTMLInputElement).value || 3);
  const button = (event.currentTarget as HTMLFormElement).querySelector("button")!;
  button.disabled = true;
  button.textContent = "多轮检索中…";
  try {
    const result = await api<AgenticSearchResult>("/api/agentic-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, topK, maxRounds, workspace: state.currentWorkspace }),
    });
    renderAgenticSearchResult(result);
    renderSources(result.sources);
    await loadAuditLogs();
  } catch (error) {
    const container = $("#agentic-search-result");
    container.className = "agent-result empty";
    container.textContent = `Agentic Search 失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = "运行 Agentic Search";
  }
}

async function runAgent(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const taskInput = $("#agent-task-input") as HTMLTextAreaElement;
  const task = taskInput.value.trim();
  if (!task) return;
  const topK = Number(($("#agent-topk-input") as HTMLInputElement).value || 6);
  const button = (event.currentTarget as HTMLFormElement).querySelector("button")!;
  button.disabled = true;
  button.textContent = "运行中…";
  try {
    const result = await api<AgentRunResult>("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, topK, workspace: state.currentWorkspace }),
    });
    renderAgentResult(result);
    if (result.sources.length) renderSources(result.sources);
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadUsers();
    await loadAuditLogs();
    await loadFeedback();
  } catch (error) {
    const container = $("#agent-result");
    container.className = "agent-result";
    container.textContent = `Agent 运行失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = "运行 Agent";
  }
}

async function exportMarkdownReport(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector("button")!;
  const formData = new FormData(form);
  const workspace = String(formData.get("workspace") || "all").trim() || "all";
  const container = $("#export-result");
  button.disabled = true;
  button.textContent = "导出中…";
  try {
    const headers = new Headers();
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    const response = await fetch(`/api/export/markdown?workspace=${encodeURIComponent(workspace)}`, { headers });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as any;
      throw new Error(data.error || `导出失败：${response.status}`);
    }
    const markdown = await response.text();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const filename = `seka-report-${workspace}.md`;
    container.className = "sources-list";
    container.innerHTML = `
      <article class="source-item">
        <h3>报告已生成</h3>
        <p>范围：${escapeHtml(workspace)} · 大小：${formatBytes(blob.size)}</p>
        <a href="${url}" download="${escapeHtml(filename)}">下载 ${escapeHtml(filename)}</a>
        <pre class="report-preview">${escapeHtml(markdown.slice(0, 1200))}</pre>
      </article>
    `;
    await loadAuditLogs();
  } catch (error) {
    container.className = "sources-list empty";
    container.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = "导出 Markdown";
  }
}

async function submitFeedback(type: "correct" | "wrong" | "save"): Promise<void> {
  if (!state.lastQuestion || !state.lastAnswer) {
    addMessage("assistant", "暂无可反馈的回答。");
    return;
  }
  const comment =
    type === "wrong" || type === "save"
      ? window.prompt(type === "wrong" ? "请补充错误原因：" : "可选：补充要沉淀的知识：", "") || ""
      : "";
  try {
    const data = await api<{ feedback: { savedDocument?: KnowledgeDocument } }>("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qaId: state.lastQaId,
        question: state.lastQuestion,
        answer: state.lastAnswer,
        feedbackType: type,
        comment,
        sources: state.lastSources,
      }),
    });
    const saved = data.feedback.savedDocument
      ? `，并已保存为知识：${data.feedback.savedDocument.title}`
      : "";
    addMessage("assistant", `反馈已记录${saved}。`);
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadAuditLogs();
    await loadFeedback();
  } catch (error) {
    addMessage("assistant", `反馈失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleDocAction(event: MouseEvent): Promise<void> {
  const button = (event.target as Element).closest("button[data-action]") as HTMLButtonElement | null;
  if (!button) return;
  const item = (event.target as Element).closest(".doc-item") as HTMLElement | null;
  const id = item?.dataset.id;
  if (!id) return;
  const action = button.dataset.action;
  try {
    if (action === "delete") {
      if (!window.confirm("确定删除该文档及其索引吗？")) return;
      await api(`/api/documents/${id}`, { method: "DELETE" });
      addMessage("assistant", "文档已删除。");
      const detail = $("#document-detail");
      detail.className = "document-detail empty";
      detail.textContent = "请选择左侧文档查看详情与切块";
    }
    if (action === "detail") {
      await loadDocumentDetail(id);
      return;
    }
    if (action === "reindex") {
      await api(`/api/documents/${id}/reindex`, { method: "POST" });
      addMessage("assistant", "文档已重新索引。");
    }
    await loadDocuments();
    await loadStats();
    await loadWorkspaces();
    await loadAuditLogs();
    await loadFeedback();
  } catch (error) {
    addMessage("assistant", `操作失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

document.addEventListener("click", (event) => {
  const feedbackButton = (event.target as Element).closest("button[data-feedback]") as HTMLButtonElement | null;
  if (feedbackButton) {
    void submitFeedback(feedbackButton.dataset.feedback as "correct" | "wrong" | "save");
  }
});

$("#upload-form").addEventListener("submit", (event) => void uploadDocument(event as SubmitEvent));
$("#url-form").addEventListener("submit", (event) => void importUrl(event as SubmitEvent));
$("#query-form").addEventListener("submit", (event) => void askQuestion(event as SubmitEvent));
$("#search-form").addEventListener("submit", (event) => void searchKnowledge(event as SubmitEvent));
$("#agentic-search-form").addEventListener("submit", (event) => void runAgenticSearch(event as SubmitEvent));
$("#agent-form").addEventListener("submit", (event) => void runAgent(event as SubmitEvent));
$("#export-form").addEventListener("submit", (event) => void exportMarkdownReport(event as SubmitEvent));
$("#login-form").addEventListener("submit", (event) => void login(event as SubmitEvent));
$("#change-password-form").addEventListener("submit", (event) => void changePassword(event as SubmitEvent));
$("#create-user-form").addEventListener("submit", (event) => void createUser(event as SubmitEvent));
$("#logout-btn").addEventListener("click", () => void logout());
$("#refresh-docs").addEventListener("click", () => void loadDocuments());
$("#refresh-stats").addEventListener("click", () => void loadStats());
$("#refresh-settings").addEventListener("click", () => void loadSettings());
$("#refresh-users").addEventListener("click", () => void loadUsers());
$("#users-list").addEventListener("click", (event) => void toggleUserStatus(event as MouseEvent));
$("#users-list").addEventListener("submit", (event) => void updateUserWorkspaces(event as SubmitEvent));
$("#refresh-audit").addEventListener("click", () => void loadAuditLogs());
$("#refresh-feedback").addEventListener("click", () => void loadFeedback());
$("#docs-list").addEventListener("click", (event) => void handleDocAction(event as MouseEvent));
$("#document-detail").addEventListener("submit", (event) => void updateDocumentMetadata(event as SubmitEvent));
$("#feedback-list").addEventListener("submit", (event) => void resolveFeedback(event as SubmitEvent));
$("#workspace-select").addEventListener("change", (event) => {
  state.currentWorkspace = (event.currentTarget as HTMLSelectElement).value;
});

void loadHealth();
void (async () => {
  await loadMe();
  if (state.user) await refreshAfterAuth();
})();
