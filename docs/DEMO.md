# SEKA Demo Walkthrough

这份文档用于面试、录屏或 GitHub README 展示。建议先运行：

```powershell
npm install
npm run seed
npm run dev
```

打开：

```text
http://127.0.0.1:8765
```

默认开发账号：

```text
admin / admin123
```

正式演示前建议在 `.env` 或终端环境变量中修改 `SEKA_ADMIN_PASSWORD`。

## 1. 登录与总览

1. 使用 admin 登录。
2. 查看「知识库概览」：
   - 文档数
   - chunks
   - workspace
   - 反馈状态
   - QA / 审计数量
3. 查看「运行设置」：
   - 数据目录
   - 上传限制
   - OCR 语言
   - LLM 是否配置
   - 默认密码风险提示

面试表达：

> 这个项目不是单纯 RAG demo，而是包含用户、权限、审计、运行配置和可验证测试链路的本地知识库 Agent。

## 2. 上传与文档维护

1. 上传一份 Markdown / TXT / PDF / 图片。
2. 设置：
   - title
   - workspace，例如 `resume` 或 `company`
   - tags
   - description
3. 在左侧文档列表点「详情」。
4. 查看：
   - parser
   - chunk 数
   - 摘要
   - chunk 预览
5. 修改元数据并保存，观察 workspace/tag 更新。

面试表达：

> 我把知识索引过程做成可解释的，用户可以看到文档如何被解析、切块，也可以维护 workspace 和 tags 来优化后续检索。

## 3. 检索、问答与引用溯源

推荐问题：

```text
SEKA 作为简历项目有哪些亮点？
```

演示顺序：

1. 在「知识检索」里搜索关键词，展示原始命中 chunk。
2. 在问答框提问，展示回答和引用来源。
3. 点「回答错误」或「保存为知识」，演示反馈进入知识库迭代闭环。

面试表达：

> 回答不是黑盒生成，前端会展示来源 chunk、分数、页码等信息，降低企业知识库里 AI 幻觉的风险。

## 4. Agent 工作台

推荐任务：

```text
分析当前知识库还缺少哪些内容
```

或：

```text
总结 SEKA 作为简历项目的亮点
```

演示重点：

- intent 自动识别
- 工具调用记录
- workspace 范围
- 来源引用

面试表达：

> Agent 不只是聊天，它会根据任务选择知识查询、缺口分析、总结、网页导入等工具，并记录工具调用链路。

## 5. 权限与 workspace 隔离

1. 在「用户管理」创建 viewer：
   - username: `viewer-demo`
   - password: `viewer123`
   - role: `viewer`
   - 授权空间：`resume`
2. 使用 viewer 登录。
3. 验证：
   - 只能看到 `resume` 相关文档。
   - 查询 `company` workspace 会被拒绝。
   - 无法上传文档。
4. 切回 admin，禁用 / 启用该用户。

面试表达：

> 企业知识库通常有部门隔离诉求，所以我实现了 RBAC + workspace 级访问控制。

## 6. 反馈修正闭环

1. 对一条回答提交「回答错误」。
2. 在「反馈修正工作台」填写正确结论。
3. 勾选保存为修正知识。
4. 再次搜索 / 问答，验证修正知识已入库。

面试表达：

> 知识库不是一次性静态索引，而是可以通过用户反馈不断迭代。

## 7. 导出报告

1. 在「导出报告」输入 workspace，例如 `resume`。
2. 导出 Markdown。
3. 展示报告包含：
   - 知识空间统计
   - 文档清单
   - 摘要
   - 反馈状态

面试表达：

> 我加入了报告导出能力，方便团队复盘知识库状态，也适合给非技术用户查看。

## 8. 自动验证

演示最后运行：

```powershell
npm test
```

覆盖：

```text
typecheck → smoke test → HTTP API integration test
```

面试表达：

> 这个项目有自动化测试覆盖核心业务和真实 HTTP API，不只是页面能点。
