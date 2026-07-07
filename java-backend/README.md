# SEKA Java Backend

独立 Java 后端版本，使用 **Spring Boot 3 + Java 21 + Spring Data JPA + H2**。

## 启动

```powershell
cd java-backend
mvn spring-boot:run
```

默认地址：`http://127.0.0.1:8865`

默认账号：`admin / admin123`

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
- workspace 维度 Markdown 报告导出

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
GET  /api/documents/{id}/chunks
GET  /api/workspaces

POST /api/search
POST /api/query
POST /api/agent/run

POST /api/feedback
GET  /api/feedback
GET  /api/export/markdown?workspace=resume
```

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
- OpenAPI / Swagger
- Testcontainers 集成测试
