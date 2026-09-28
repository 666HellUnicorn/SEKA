# SEKA API Examples

下面示例默认服务运行在：

```text
http://127.0.0.1:8765
```

PowerShell 里先登录并保存 token：

```powershell
$login = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/auth/login" `
  -ContentType "application/json" `
  -Body '{"username":"admin","password":"admin123"}'

$token = $login.token
$headers = @{ Authorization = "Bearer $token" }
```

## 健康检查

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/health"
```

## 当前用户

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8765/api/auth/me" `
  -Headers $headers
```

## 上传文档

PowerShell 自带 multipart 对文件名兼容性不稳定；推荐浏览器上传或使用 Node / curl。

curl 示例：

```bash
curl -X POST "http://127.0.0.1:8765/api/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./README.md" \
  -F "title=SEKA README" \
  -F "workspace=resume" \
  -F "tags=demo,readme" \
  -F "description=Project README as knowledge"
```

## 文档列表

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8765/api/documents" `
  -Headers $headers
```

## 文档详情与 chunks

```powershell
$docs = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/documents" -Headers $headers
$docId = $docs.documents[0].id

Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/documents/$docId" -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/documents/$docId/chunks" -Headers $headers
```

## 更新文档元数据

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/documents/$docId/metadata" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"title":"Updated title","workspace":"resume","tags":"resume,updated","description":"Updated description"}'
```

## 搜索知识片段

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/search" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"query":"简历亮点","workspace":"resume","topK":5}'
```

## 知识库问答

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/query" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"question":"SEKA 作为简历项目有哪些亮点？","workspace":"resume","topK":5}'
```

## Agentic Search + Grep

默认只使用本地 grep-style 检索；传入 `useJev=true` 后，如果配置了
`TYPESAFE_API_KEY`，Jev 会负责判断是否继续下一轮以及下一轮使用扩展词还是兜底词。
没有 API Key、请求失败或超时都会自动回退到本地策略。

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/agentic-search" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"question":"这个项目如何体现权限隔离和审计能力？","workspace":"resume","topK":5,"maxRounds":3,"useJev":true}'
```

响应重点字段：

- `rounds`：每轮 grep 查询、命中数量、引用片段和 Jev 决策。
- `sources`：去重后的最终引用来源。
- `engine`：`local-grep` 或 `jev+grep`。
- `jev`：是否请求、是否实际使用、模型和回退原因。
- `toolCalls`：`grep.agentic_search` 与实际发生的 `jev.system_one` 调用。

## Agent 工作台

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/agent/run" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"task":"分析当前知识库还缺少哪些内容","workspace":"resume","topK":5}'
```

## 反馈与修正

```powershell
$feedback = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/feedback" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"question":"SEKA 是否支持反馈？","answer":"暂不支持","feedbackType":"wrong","comment":"实际支持反馈修正闭环"}'

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/feedback/$($feedback.feedback.id)/resolve" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"resolution":"SEKA 支持反馈修正，并可保存为新知识。","saveAsKnowledge":true}'
```

## 创建用户并配置 workspace 授权

```powershell
$viewer = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/users" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"username":"viewer-demo","password":"viewer123","role":"viewer","allowedWorkspaces":"resume"}'

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/users/$($viewer.user.id)/workspaces" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"allowedWorkspaces":"resume,company"}'
```

## 禁用 / 启用用户

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/api/users/$($viewer.user.id)/status" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"isActive":false}'
```

## 导出 Markdown 报告

```powershell
Invoke-WebRequest `
  -Uri "http://127.0.0.1:8765/api/export/markdown?workspace=resume" `
  -Headers $headers `
  -OutFile "seka-report-resume.md"
```

## 审计日志

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8765/api/audit-logs?limit=50" `
  -Headers $headers
```
