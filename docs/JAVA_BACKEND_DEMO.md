# SEKA Java Backend 面试演示脚本

这个文档用于单独展示 `java-backend/`：一个基于 **Spring Boot 3 + Java 21 + JPA + H2** 的本地知识库 Agent 后端。

## 1. 启动服务

```powershell
cd java-backend
mvn spring-boot:run
```

默认地址：

```text
http://127.0.0.1:8865
```

默认管理员：

```text
admin / admin123
```

也可以用 Docker 一键启动：

```powershell
cd java-backend
docker compose up --build
```

面试讲法：

> Java 后端提供独立 Dockerfile 和 docker-compose，容器启动后通过 `/actuator/health` 做健康检查，H2 数据通过 volume 持久化。这样面试或录屏时可以直接演示“一条命令启动后端服务”。

## 2. 打开 Swagger UI

```text
http://127.0.0.1:8865/swagger-ui.html
```

OpenAPI JSON：

```text
http://127.0.0.1:8865/v3/api-docs
```

面试讲法：

> Java 后端通过 springdoc-openapi 暴露接口文档，方便展示 REST API 分组、请求参数、响应结构和 Bearer Token 授权方式。这样项目不只是“能跑”，也具备团队联调和交付文档能力。

## 3. 查看健康检查和运行指标

```text
http://127.0.0.1:8865/actuator/health
http://127.0.0.1:8865/actuator/info
http://127.0.0.1:8865/actuator/metrics
```

面试讲法：

> 我给 Java 后端接入了 Spring Boot Actuator，只暴露 health、info、metrics 这类基础运维端点。这样本地演示、Docker 部署和 CI 都可以快速判断服务是否启动成功，也能展示 JVM、HTTP、数据库连接等基础指标。

## 4. 展示统一参数校验

```bash
curl -i -X POST http://127.0.0.1:8865/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"","password":"123"}'
```

预期：

```text
HTTP/1.1 400
```

响应体会包含：

```json
{
  "error": "请求参数校验失败",
  "validationErrors": {
    "username": "...",
    "password": "..."
  }
}
```

面试讲法：

> 我没有把参数校验散落在业务代码里，而是用 Bean Validation 注解约束 DTO，再通过全局异常处理器统一返回 400 和字段级 validationErrors，这样前后端联调时错误结构稳定。

## 5. 管理员登录

```bash
curl -s -X POST http://127.0.0.1:8865/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

把返回的 `token` 保存为：

```bash
export ADMIN_TOKEN="复制登录返回的 token"
```

PowerShell：

```powershell
$ADMIN_TOKEN = "复制登录返回的 token"
```

## 6. 可选：修改当前用户密码

```bash
curl -s -X POST http://127.0.0.1:8865/api/auth/password \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"oldPassword":"admin123","newPassword":"admin456"}'
```

面试讲法：

> 修改密码接口要求用户已登录，并校验旧密码。成功后会重新加盐哈希保存新密码，并写入 `auth.password_change` 审计日志。实际演示时建议用后面创建的普通 viewer 用户测试，避免改掉默认 admin 密码；如果执行了上面的 admin 示例，后续重新登录需要使用 `admin456`。

## 7. 上传两个知识空间的文档

上传 `resume` 空间：

```bash
curl -s -X POST http://127.0.0.1:8865/api/documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "title=Java Resume Knowledge" \
  -F "workspace=resume" \
  -F "tags=resume,java,interview" \
  -F "description=用于面试展示的个人项目知识" \
  -F "file=@resume.md"
```

上传 `company` 空间：

```bash
curl -s -X POST http://127.0.0.1:8865/api/documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "title=Company Private Knowledge" \
  -F "workspace=company" \
  -F "tags=company,private" \
  -F "description=公司内部资料示例" \
  -F "file=@company.md"
```

面试讲法：

> 上传后服务端会保存原始文件、抽取文本、切分 chunk，并通过 JPA 持久化 document/chunk 元数据，为后续检索和问答提供可追溯来源。

## 8. 文档列表筛选、排序与分页

```bash
curl -s "http://127.0.0.1:8865/api/documents?workspace=resume&keyword=Java&page=0&size=10&sortBy=updatedAt&sortDir=desc" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

响应会包含：

```json
{
  "documents": [],
  "page": 0,
  "size": 10,
  "totalElements": 0,
  "totalPages": 0,
  "workspace": "resume",
  "keyword": "Java",
  "sortBy": "updatedAt",
  "sortDir": "desc"
}
```

面试讲法：

> 管理后台不是只返回全量列表。我给文档列表加了 workspace、keyword、page、size、sortBy、sortDir 查询参数，并且分页前会先做用户可读 workspace 过滤，保证 viewer 这种受限账号不会因为不可见数据影响 totalElements 和 totalPages。排序字段也做了白名单限制，只允许 createdAt、updatedAt、title、workspace、filename、chunkCount、sizeBytes，避免任意字段输入造成不可控行为。这一点可以体现我考虑了后台列表接口、权限过滤、分页元数据和输入安全。

## 9. 替换文档内容并重新索引

```bash
curl -s -X PUT http://127.0.0.1:8865/api/documents/{documentId}/content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@resume-v2.md"
```

预期：

- 文档 `id` 保持不变。
- `filename`、`summary`、`sizeBytes`、`chunkCount`、`updatedAt` 更新。
- 旧 chunks 被删除，新文件内容被重新切分成 chunks。
- 审计日志新增 `document.reindex`，detail 包含 `workspace`、`filename`、`oldChunkCount`、`newChunkCount`。

可以立刻验证新内容可被检索：

```bash
curl -s -X POST http://127.0.0.1:8865/api/search \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"resume-v2 中的新关键词","workspace":"resume","topK":3}'
```

面试讲法：

> 知识库不是一次性上传就结束，而是需要持续迭代。我增加了文档内容替换接口，保持文档主键不变，只替换文件和索引内容。实现上会先校验写权限和 workspace 权限，然后删除旧 chunks、保存新文件、重新切块、更新文档摘要和 chunkCount，并写入 `document.reindex` 审计日志。这样可以展示“知识库更新后检索结果立即变化”的闭环。

## 10. 创建 viewer 用户并限制 workspace

```bash
curl -s -X POST http://127.0.0.1:8865/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer-demo","password":"viewer123","role":"viewer","allowedWorkspaces":"resume"}'
```

登录 viewer：

```bash
curl -s -X POST http://127.0.0.1:8865/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer-demo","password":"viewer123"}'
```

保存 viewer token：

```bash
export VIEWER_TOKEN="复制 viewer 登录返回的 token"
```

管理员重置 viewer 密码：

```bash
curl -s -X POST http://127.0.0.1:8865/api/users/{viewerId}/password \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"viewer456"}'
```

如果执行了重置密码，后续 viewer 登录请使用 `viewer456` 重新获取 `VIEWER_TOKEN`。

面试讲法：

> 用户自己可以通过旧密码修改密码；管理员也可以在用户忘记密码时重置指定用户密码。重置后会清理该用户已有会话，并记录 `user.password_reset` 审计日志。

## 11. 验证 workspace 隔离

viewer 查看文档：

```bash
curl -s "http://127.0.0.1:8865/api/documents?page=0&size=20" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

预期：

- 只能看到 `workspace=resume` 的文档。
- 看不到 `workspace=company` 的文档。

viewer 查询 company：

```bash
curl -i -X POST http://127.0.0.1:8865/api/query \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"company 有哪些内容？","workspace":"company","topK":3}'
```

预期：

```text
HTTP/1.1 403
```

viewer 查看 company 文档列表：

```bash
curl -i "http://127.0.0.1:8865/api/documents?workspace=company" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

预期：

```text
HTTP/1.1 403
```

viewer 上传文档：

```bash
curl -i -X POST http://127.0.0.1:8865/api/documents \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -F "workspace=resume" \
  -F "file=@resume.md"
```

预期：

```text
HTTP/1.1 403
```

面试讲法：

> 这里同时验证了 RBAC 和 workspace ABAC。viewer 有 READ 权限但没有 WRITE 权限，并且非 admin 用户只能访问 allowedWorkspaces 白名单内的数据。

## 12. 反馈闭环

提交反馈：

```bash
curl -s -X POST http://127.0.0.1:8865/api/feedback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"qaId":"qa-demo","question":"项目亮点是什么？","answer":"旧回答","workspace":"resume","feedbackType":"incorrect","comment":"需要补充权限与审计日志"}'
```

处理反馈：

```bash
curl -s -X POST http://127.0.0.1:8865/api/feedback/{feedbackId}/resolve \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolution":"已补充授权与审计日志说明"}'
```

面试讲法：

> 反馈不是只记录“赞/踩”，而是形成 open → resolved 的状态流转，能支撑知识库持续迭代。
> 每条反馈也会记录 workspace，因此 `resume` 报告只展示 `resume` 反馈，不会混入 `company` 空间的问题。

按空间查看反馈：

```bash
curl -s "http://127.0.0.1:8865/api/feedback?workspace=resume" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 13. 导出 Markdown 报告

```bash
curl -s "http://127.0.0.1:8865/api/export/markdown?workspace=resume" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

报告包含：

- 知识空间统计
- 文档清单
- 摘要
- 反馈状态

## 14. 查看审计日志

```bash
curl -s http://127.0.0.1:8865/api/audit-logs \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

按动作过滤：

```bash
curl -s "http://127.0.0.1:8865/api/audit-logs?action=feedback.resolve&resourceType=feedback&limit=50" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

重点观察：

- `auth.login`
- `auth.password_change`
- `user.password_reset`
- `document.upload`
- `knowledge.query`
- `knowledge.export_markdown`
- `feedback.resolve`
- `document.update_metadata`
- `document.reindex`
- `document.delete`

面试讲法：

> 审计日志的 detail 不是简单字符串拼接，而是 JSON 结构化存储和返回。例如文档元数据更新会记录 workspace、title 等字段，并且接口支持按 action、username、resourceType 和 limit 过滤，后续可以继续接入审计检索、风险告警或管理后台筛选。

## 15. 简历描述

可以写成：

> 独立实现 SEKA Java 后端版本，基于 Spring Boot 3、Java 21、Spring Data JPA 和 H2 构建本地知识库 Agent 服务，支持文档上传切块、文档列表筛选/排序/分页、文档内容替换与重新索引、检索问答、workspace 数据隔离、admin/editor/viewer RBAC、账号修改/重置密码、审计日志、按空间隔离的反馈修正闭环、Markdown 报告导出、OpenAPI/Swagger 接口文档、Actuator 健康检查、Bean Validation 参数校验和 Docker 容器化交付，并通过集成测试覆盖权限隔离、列表分页、用户禁用启用、文档维护、文档重建索引、反馈处理、导出、可观测性和错误响应链路。

## 16. 面试回答模板

**Q：为什么要单独做 Java 后端？**

A：原项目是 TypeScript 全栈，为了证明我能把同一个 Agent 业务抽象迁移到企业常用 Java 后端体系，我单独实现了 Spring Boot 版本。它不是简单 CRUD，而是保留了知识库 Agent 的核心领域模型：用户、角色、workspace、文档、chunk、检索、问答、反馈和审计。

**Q：权限如何设计？**

A：分两层。第一层是 RBAC，admin/editor/viewer 决定管理、写入和只读能力。第二层是 workspace 级访问控制，非 admin 用户只能访问 allowedWorkspaces 内的数据。所有文档列表、详情、检索、问答和导出都会校验 workspace。

**Q：如何体现可迭代知识库？**

A：我做了两层迭代能力。第一层是文档级迭代，可以替换已有文档内容并重新生成 chunks，文档 ID 不变但检索结果会立即更新。第二层是反馈级迭代，用户可以对问答提交反馈，管理员处理后标记 resolved。报告导出会展示反馈状态，审计日志会记录处理动作。后续可以把 resolved 反馈进一步沉淀为修正知识并触发重新索引。
