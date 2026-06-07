# SEKA 简历与面试包装

## 项目名称

**SEKA — Self-Evolving Knowledge Agent**

中文名称可以写作：

> 可本地部署的自迭代知识库 Agent 系统

## 一句话简介

用 TypeScript 实现一个本地个人 / 企业知识库 Agent，支持多格式文档解析、混合检索、RAG 问答、引用溯源、权限控制和用户反馈再入库闭环。

## 简历项目描述

### 版本 A：偏全栈

设计并实现 TypeScript 全栈本地知识库 Agent 系统，支持文档上传、解析切块、SQLite 知识存储、混合检索、RAG 问答、引用溯源、用户反馈迭代、RBAC 权限和 Docker 本地部署，用于解决个人 / 企业资料分散、检索困难和 AI 回答不可验证的问题。

### 版本 B：偏 AI / Agent

实现一个可迭代的知识库 Agent 平台：通过多格式资料入库、workspace 隔离、混合检索和带引用问答构建可追溯 RAG 流程，并设计 Agent 工作台自动识别问答、对比、缺口分析、总结和网页导入任务，记录工具调用链路以提升回答可解释性。

### 版本 C：偏工程化

从 0 到 1 构建本地知识库 Agent MVP，覆盖前端交互、Node.js API、SQLite 数据模型、权限审计、自动化测试、Docker Compose 和 CI，形成可运行、可演示、可扩展的简历级全栈项目。

## 推荐简历 bullet

可以选 5–7 条放进简历：

- 使用 TypeScript + Node.js 实现本地知识库 Agent，覆盖文档上传、解析切块、检索、RAG 问答、引用溯源和反馈再入库闭环。
- 设计 SQLite 数据模型，支持 documents、chunks、QA history、feedback、users、sessions、audit logs 等核心实体。
- 实现 Markdown、TXT、JSON、CSV、PDF、图片 OCR 和网页 URL 导入，支持 workspace、tags、description 等知识元数据。
- 构建 BM25 风格关键词检索 + 哈希向量近似语义检索的混合召回能力，并在回答中返回可追溯 citation。
- 设计 Agent 工作台，自动识别问答、对比、缺口分析、总结、网页导入等意图，并记录工具调用过程。
- 实现 admin/editor/viewer 三类角色、Bearer Token 会话、用户启用 / 禁用、改密、workspace 授权和审计日志。
- 构建无框架 Web UI，支持仪表盘、上传、检索、问答、Agent、来源查看、文档详情、用户管理、反馈修正和 Markdown 报告导出。
- 编写 smoke test 和 HTTP API integration test，覆盖上传、解析、检索问答、权限拒绝、用户管理、导出和改密等端到端链路。
- 提供 Docker Compose、本地环境配置示例和 GitHub Actions CI，提升项目交付完整度。

## 技术栈写法

```text
TypeScript, Node.js, SQLite, Native HTTP Server, HTML/CSS, RAG, Agent Workflow,
BM25-like Retrieval, OCR, PDF Parsing, RBAC, Docker, GitHub Actions
```

如果简历空间紧张，可以压缩为：

```text
TypeScript / Node.js / SQLite / RAG / Agent / RBAC / Docker / CI
```

## 面试讲解结构

建议按 5 分钟讲：

### 1. 背景问题

很多团队资料散落在文档、网页、会议纪要和项目说明里，普通搜索不够语义化，直接接 LLM 又容易出现不可追溯答案。因此我做了一个本地知识库 Agent，把资料入库、检索、问答、引用和反馈修正放在一个闭环里。

### 2. 核心流程

```text
上传 / URL 导入 → 解析 → 切块 → SQLite 存储 → 混合检索
→ RAG 回答 → 引用来源 → 用户反馈 → 修正知识再入库
```

### 3. 你负责的重点

- 数据模型设计。
- 文档解析与 chunking。
- 检索和 citation。
- Agent 任务编排。
- 权限 / workspace 隔离。
- 前端操作台。
- 自动化测试和 Docker 交付。

### 4. 最有技术含量的点

- **可解释 RAG**：不是只返回答案，而是返回每条引用来自哪个文档、哪个 chunk、分数是多少。
- **反馈迭代**：错误答案可以被处理成修正知识，下一次检索会命中新知识。
- **workspace 权限**：贴近企业知识库，非 admin 用户只能访问授权空间。
- **Agent 工具链路**：记录每次 Agent 选择了什么工具、输入输出摘要和执行状态。

### 5. 未来迭代

- 替换为 Qdrant / Chroma / pgvector。
- 增加 reranker 和评测集。
- 接入 Git、Notion、飞书、Confluence 等数据源。
- 前端升级为 React / Next.js。
- 增加批量导入、定时同步、HTML/PDF 报告导出。

## Demo 话术

面试或录屏时可以这样演示：

1. 登录系统，展示仪表盘和运行设置。
2. 上传一份 Markdown / PDF 文档，填写 workspace 和 tags。
3. 打开文档详情，展示解析器、摘要和 chunk 预览。
4. 在问答区提问，强调答案带引用来源。
5. 切到搜索区，展示直接检索 chunks。
6. 在 Agent 工作台输入“总结这个 workspace 的核心内容”或“分析目前知识缺口”。
7. 提交一条错误反馈，再用“保存为知识”完成修正。
8. 创建 viewer 用户，只授权一个 workspace，展示权限隔离。
9. 导出 Markdown 报告。
10. 最后运行 `npm test` 或展示 CI，证明项目可验证。

## 面试可能被问到的问题

### Q1：为什么没有直接用 LangChain？

为了展示底层原理和工程能力，我先手写了文档解析、切块、检索、引用和 Agent 编排。后续如果追求生态扩展，可以再接 LangChain / LlamaIndex。

### Q2：为什么用 SQLite？

这个项目目标是本地部署和简历演示，SQLite 足够轻量，便于一条命令启动。生产环境可以迁移到 PostgreSQL + pgvector 或专门的向量数据库。

### Q3：现在的向量检索是否足够生产？

当前是 MVP 级哈希向量近似检索，主要用于展示 RAG 流程。生产版本会引入 embedding model、向量库和 reranker，并建立评测集衡量召回率和准确率。

### Q4：项目如何保证答案可信？

答案会返回 citation，包括文档标题、chunk、页码、section、snippet 和分数；用户可以查看来源。如果答案错误，可以提交反馈并将修正内容保存为新知识。

### Q5：企业场景的权限怎么做？

系统有 admin/editor/viewer 三类角色。admin 可以管理用户和审计日志；非 admin 用户可以被限制到指定 workspace，只能访问授权空间的文档、检索、问答和导出。

## GitHub README 摘要

如果要放在 GitHub 首页，可以使用：

```text
SEKA is a local-first self-evolving knowledge agent built with TypeScript.
It ingests documents and URLs, parses and chunks content, stores knowledge in SQLite,
retrieves relevant sources with hybrid search, answers questions with citations,
and improves over time through feedback corrections.
```

## 项目吸引人的原因

- 不是纯 UI，也不是纯算法 demo，而是一个完整产品雏形。
- 覆盖 AI 应用开发中常见的关键问题：知识接入、检索、引用、权限、反馈、部署。
- 可以演示真实交互，不只是代码片段。
- 有测试和 CI，能体现工程质量。
- 未来扩展路径清晰，面试时容易展开讨论。

