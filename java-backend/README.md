# SEKA Java Backend

独立 Java 后端版本，使用 **Spring Boot 3 + Java 21 + Spring Data JPA + H2**。

## 启动

```powershell
cd java-backend
mvn spring-boot:run
```

默认地址：`http://127.0.0.1:8865`

默认账号：`admin / admin123`

完整面试演示脚本见：[docs/JAVA_BACKEND_DEMO.md](../docs/JAVA_BACKEND_DEMO.md)。

## 当前版本定位

这个版本复刻 TypeScript 后端的核心业务，并升级为 Java 常见企业后端结构：

```text
Controller → Service → Spring Data JPA Repository → H2 DB
```

数据会持久化到：

```text
java-backend/data-java/seka-java.mv.db
```

## 已实现能力

- Bearer Token 登录会话
- admin / editor / viewer RBAC
- workspace 授权白名单
- 用户启用 / 禁用
- 审计日志落库
- 文档上传与本地文件保存
- 文档切块与 chunk 持久化
- 关键词检索
- 本地提取式 RAG 问答
- Agent run 与 tool call 返回
- 用户反馈落库
- 反馈处理闭环：open → resolved，记录处理人和处理说明
- 文档维护：修改 title / workspace / tags / description
- 文档删除：删除文档、chunks 和本地上传文件
- workspace 维度 Markdown 报告导出
- OpenAPI / Swagger UI 接口文档

## 主要接口

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

GET  /api/users                  admin
POST /api/users                  admin
POST /api/users/{id}/status      admin
POST /api/users/{id}/workspaces  admin
GET  /api/audit-logs             admin

GET  /api/documents
POST /api/documents              multipart/form-data
GET  /api/documents/{id}
PATCH /api/documents/{id}/metadata editor/admin
DELETE /api/documents/{id}          editor/admin
GET  /api/documents/{id}/chunks
GET  /api/workspaces

POST /api/search
POST /api/query
POST /api/agent/run

POST /api/feedback
POST /api/feedback/{id}/resolve
GET  /api/feedback
GET  /api/export/markdown?workspace=resume
```

## OpenAPI / Swagger

启动后可访问：

```text
http://127.0.0.1:8865/swagger-ui.html
http://127.0.0.1:8865/v3/api-docs
```

面试展示时可以用 Swagger UI 说明接口分层、Bearer Token 授权、用户管理、文档入库、检索问答、反馈处理和报告导出链路。

## 面试展示重点

这个 Java 版本可以重点讲成一个“企业知识库后端”的完整闭环：

1. **认证授权**：登录后签发 Bearer Token，会话持久化到 DB。
2. **RBAC**：admin / editor / viewer 三类角色分别控制管理、写入和只读能力。
3. **空间隔离**：非 admin 账号通过 `allowedWorkspaces` 限制可访问的知识空间。
4. **知识入库**：文档上传后保存原文件、抽取文本、切 chunk、落库。
5. **可解释检索**：检索和问答都会返回来源 chunk，方便追溯答案依据。
6. **反馈闭环**：用户提交错误反馈，管理员处理后标记 resolved，并出现在报告中。
7. **审计日志**：登录、上传、查询、导出、文档维护、反馈处理都会写审计记录。
8. **报告导出**：按 workspace 导出 Markdown，包含空间统计、文档清单、摘要、反馈状态。
9. **OpenAPI 文档**：通过 Swagger UI 提供可交互接口文档，方便演示和联调。
10. **集成测试**：覆盖 viewer 隔离、禁止上传、禁用启用用户、报告导出、反馈处理、审计日志和 OpenAPI 文档。

## H2 Console

开发环境可访问：

```text
http://127.0.0.1:8865/h2-console
```

连接串：

```text
jdbc:h2:file:./data-java/seka-java
```

用户名：`sa`，密码为空。

## 后续可继续升级

- H2 切换 PostgreSQL
- 引入 pgvector / Milvus / Qdrant
- Spring Security + JWT
- Flyway 数据库迁移
- Testcontainers 集成测试
