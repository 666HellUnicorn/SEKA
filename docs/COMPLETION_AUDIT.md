# SEKA 完成度审计

本文用于把最初目标拆成可检查的交付项，方便后续提交 GitHub、写简历、录屏或面试讲解。

## 目标对齐

用户目标：

> 构建一个可本地部署的个人 / 企业知识库 Agent 工具，支持持续迭代，并作为 TypeScript 简历项目展示。

当前实现已经覆盖一个可演示、可运行、可测试的 MVP：

| 目标项 | 完成状态 | 证据 |
|---|---:|---|
| TypeScript 全栈项目 | 已完成 | `src/server/*.ts`、`web/app.ts`、`src/shared/types.ts` |
| 本地知识库 | 已完成 | SQLite 本地库、上传目录、`data/` 运行数据 |
| 个人 / 公司知识空间 | 已完成 | 文档 `workspace`、`tags`、`description`，workspace 统计与导出 |
| 多格式资料接入 | 已完成 | Markdown、TXT、JSON、CSV、PDF、图片 OCR、URL 导入 |
| 解析、切块、索引 | 已完成 | `parsers.ts`、`chunking.ts`、`retrieval.ts`、`core.ts` |
| RAG 问答与引用来源 | 已完成 | `/api/query` 返回 answer + citations |
| 直接检索 | 已完成 | `/api/search` 返回 scored chunks |
| Agent 工作台 | 已完成 | `/api/agent/run`，支持问答、对比、缺口分析、总结、网页导入 |
| 反馈迭代闭环 | 已完成 | feedback 创建、resolve、保存修正为新知识 |
| 用户、权限、审计 | 已完成 | 登录、Bearer Token、admin/editor/viewer、审计日志 |
| workspace 级访问控制 | 已完成 | 非 admin 用户可限制到指定 workspace |
| 前端可视化操作 | 已完成 | 上传、导入、问答、检索、Agent、文档详情、反馈、用户管理 |
| 报告导出 | 已完成 | `/api/export/markdown?workspace=...` |
| 部署交付 | 已完成 | `Dockerfile`、`docker-compose.yml`、`.env.example` |
| 自动验证 | 已完成 | `npm test`、smoke test、HTTP API integration test、CI |

## 关键能力清单

### 1. 知识入库

- 上传接口：`POST /api/documents`
- URL 导入：`POST /api/sources/url`
- 支持元数据：title、workspace、tags、description、sourceUrl
- 文档详情：`GET /api/documents/{id}`
- chunk 预览：`GET /api/documents/{id}/chunks`
- 元数据维护：`POST /api/documents/{id}/metadata`
- 重新索引：`POST /api/documents/{id}/reindex`
- 删除文档：`DELETE /api/documents/{id}`

### 2. 检索与问答

- 混合检索：BM25 风格关键词分数 + 哈希向量近似语义分数。
- RAG 问答：默认本地提取式回答；可通过 OpenAI-compatible API 接入远程 / 本地模型。
- 引用来源：返回文档名、chunk、页码、section、分数和 snippet，便于解释答案。

### 3. Agent 编排

Agent 工作台将自然语言任务映射为意图：

- `answer`：知识库问答。
- `compare`：对比多个资料或主题。
- `gap_analysis`：分析知识缺口。
- `summarize`：总结 workspace 或文档内容。
- `ingest_url`：识别 URL 并调用网页导入。

每次运行会记录 tool calls，方便展示“Agent 不是黑盒回答，而是有步骤的工具编排”。

### 4. 反馈迭代

反馈闭环：

```text
用户提问 → 返回答案和引用 → 用户指出错误 / 补充 → 反馈进入待处理 → 管理员修正 → 可保存为新知识 → 重新参与检索问答
```

这部分是项目区别于普通 RAG demo 的重点：它强调知识库可持续维护，而不只是一次性上传资料。

### 5. 权限与审计

- 默认管理员：`admin / admin123`。
- 支持通过环境变量覆盖默认管理员账号密码。
- 当前用户可修改密码。
- admin 可创建用户、分配角色、启用 / 禁用用户。
- 非 admin 用户可限制到具体 workspace。
- 写操作、查询、导出、Agent 运行等关键行为写入审计日志。

## 工程化证据

| 类型 | 文件 / 命令 |
|---|---|
| 后端入口 | `src/server/server.ts` |
| 核心业务 | `src/server/core.ts` |
| Agent | `src/server/agent.ts` |
| 数据访问 | `src/server/db.ts` |
| 前端入口 | `web/index.html`、`web/app.ts`、`web/styles.css` |
| 类型定义 | `src/shared/types.ts` |
| 演示数据 | `scripts/seed-demo.ts` |
| 核心 smoke test | `scripts/smoke-test.ts` |
| HTTP 集成测试 | `scripts/api-test.ts` |
| Docker | `Dockerfile`、`docker-compose.yml` |
| CI | `.github/workflows/ci.yml` |
| 完整验证 | `npm test` |

## 已验证链路

`npm test` 会依次运行：

```powershell
npm run typecheck
npm run smoke
npm run test:api
```

覆盖的核心链路：

```text
登录 → 上传 → 解析切块 → 文档详情 → 元数据更新 → 检索 → 问答 → 引用来源
→ 设置 / 统计 / 导出 → 创建 viewer → workspace 授权 → 权限拒绝
→ 用户禁用 / 启用 → 当前用户改密
```

## 简历展示价值

这个项目比普通 “ChatPDF / RAG demo” 更适合简历，因为它同时展示：

1. **端到端能力**：前端、后端、数据库、测试、Docker、CI 都有。
2. **产品思考**：不是只做聊天，而是围绕知识沉淀、权限、审计、反馈迭代设计。
3. **Agent 思维**：有任务识别、工具调用、引用来源和运行记录。
4. **工程边界**：默认本地可跑，也可接 OpenAI-compatible API。
5. **企业场景**：workspace 隔离、用户角色、报告导出、审计日志都贴近公司知识库需求。

## 当前 MVP 边界

这些不是缺陷，而是后续迭代方向，面试时可以主动说明：

- 当前使用 Node 24 的实验性能力：`node:sqlite` 和原生 TypeScript strip。
- 当前语义检索是哈希向量近似方案，适合 MVP 展示；生产环境建议替换为 Qdrant、Chroma、Milvus 或 pgvector。
- 默认密码仅用于开发演示，正式部署必须通过环境变量修改。
- OCR 默认语言为 `eng`，中文 OCR 需要额外配置语言数据或接入 PaddleOCR 等方案。
- 前端是无框架实现，利于展示原理；后续可以升级 React / Next.js。
- URL 导入依赖网络环境，自动化测试中没有强依赖外部网页。

## 建议验收口径

如果要把它作为简历项目提交，可以用以下标准判断是否“完成”：

- 可以 `npm run dev` 本地启动。
- 可以登录前端并完成上传、检索、问答、反馈、导出。
- 可以 `npm test` 通过完整验证。
- README 能让别人 5 分钟内跑起来。
- `docs/DEMO.md` 能支撑录屏或面试现场演示。
- `docs/RESUME.md` 能直接提炼进简历。

