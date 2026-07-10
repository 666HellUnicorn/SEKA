package com.seka;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "seka.data-dir=target/test-data",
        "spring.datasource.url=jdbc:h2:mem:seka-test;DB_CLOSE_DELAY=-1",
        "spring.jpa.hibernate.ddl-auto=create-drop"
    }
)
class SekaJavaApiIntegrationTest {
  @LocalServerPort int port;
  @Autowired TestRestTemplate rest;

  @Test
  void authUploadWorkspaceAndUserStatusFlow() {
    String base = "http://127.0.0.1:" + port;
    String adminToken = login(base, "admin", "admin123");

    Map<String, Object> resumeDoc = upload(base, adminToken, "resume.md", "# Resume\nSEKA Java 支持 resume 知识空间。", "resume");
    Map<String, Object> companyDoc = upload(base, adminToken, "company.md", "# Company\nSEKA Java 支持 company 知识空间。", "company");
    assertThat(resumeDoc).containsKey("document");
    String resumeDocId = String.valueOf(((Map<String, Object>) resumeDoc.get("document")).get("id"));
    String companyDocId = String.valueOf(((Map<String, Object>) companyDoc.get("document")).get("id"));

    ResponseEntity<Map> updatedDoc = patchJson(base + "/api/documents/" + resumeDocId + "/metadata", adminToken, Map.of(
        "title", "Java Resume Knowledge",
        "workspace", "resume",
        "tags", "resume,java,interview",
        "description", "updated metadata"
    ));
    assertThat(updatedDoc.getStatusCode()).isEqualTo(HttpStatus.OK);
    Map<String, Object> updatedDocument = (Map<String, Object>) updatedDoc.getBody().get("document");
    assertThat(updatedDocument.get("title")).isEqualTo("Java Resume Knowledge");

    ResponseEntity<Map> created = postJson(base + "/api/users", adminToken, Map.of(
        "username", "viewer-demo",
        "password", "viewer123",
        "role", "viewer",
        "allowedWorkspaces", "resume"
    ));
    assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    Map<String, Object> user = (Map<String, Object>) created.getBody().get("user");
    String viewerId = String.valueOf(user.get("id"));

    String viewerToken = login(base, "viewer-demo", "viewer123");
    ResponseEntity<Map> docs = get(base + "/api/documents", viewerToken);
    assertThat(docs.getStatusCode()).isEqualTo(HttpStatus.OK);
    List<Map<String, Object>> documents = (List<Map<String, Object>>) docs.getBody().get("documents");
    assertThat(documents).isNotEmpty();
    assertThat(documents).allMatch(doc -> "resume".equals(doc.get("workspace")));

    ResponseEntity<Map> deniedQuery = postJson(base + "/api/query", viewerToken, Map.of("question", "company 有什么？", "workspace", "company", "topK", 3));
    assertThat(deniedQuery.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

    ResponseEntity<Map> deniedUpload = uploadResponse(base, viewerToken, "blocked.md", "blocked", "resume");
    assertThat(deniedUpload.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

    ResponseEntity<Map> deniedPatch = patchJson(base + "/api/documents/" + resumeDocId + "/metadata", viewerToken, Map.of("title", "blocked"));
    assertThat(deniedPatch.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

    ResponseEntity<Map> disabled = postJson(base + "/api/users/" + viewerId + "/status", adminToken, Map.of("isActive", false));
    assertThat(disabled.getStatusCode()).isEqualTo(HttpStatus.OK);
    ResponseEntity<Map> disabledLogin = rest.postForEntity(base + "/api/auth/login", Map.of("username", "viewer-demo", "password", "viewer123"), Map.class);
    assertThat(disabledLogin.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

    ResponseEntity<Map> enabled = postJson(base + "/api/users/" + viewerId + "/status", adminToken, Map.of("isActive", true));
    assertThat(enabled.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(login(base, "viewer-demo", "viewer123")).isNotBlank();

    ResponseEntity<Map> feedback = postJson(base + "/api/feedback", adminToken, Map.of(
        "qaId", "qa-demo",
        "question", "resume 项目亮点是什么？",
        "answer", "旧回答",
        "feedbackType", "incorrect",
        "comment", "需要补充权限与审计日志"
    ));
    assertThat(feedback.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    String feedbackId = String.valueOf(((Map<String, Object>) feedback.getBody().get("feedback")).get("id"));
    ResponseEntity<Map> resolved = postJson(base + "/api/feedback/" + feedbackId + "/resolve", adminToken, Map.of("resolution", "已补充授权与审计日志说明"));
    assertThat(resolved.getStatusCode()).isEqualTo(HttpStatus.OK);
    Map<String, Object> resolvedFeedback = (Map<String, Object>) resolved.getBody().get("feedback");
    assertThat(resolvedFeedback.get("status")).isEqualTo("resolved");
    assertThat(resolvedFeedback.get("resolvedBy")).isEqualTo("admin");

    ResponseEntity<Map> deleted = delete(base + "/api/documents/" + companyDocId, adminToken);
    assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.OK);
    ResponseEntity<Map> deletedDoc = get(base + "/api/documents/" + companyDocId, adminToken);
    assertThat(deletedDoc.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

    ResponseEntity<Map> auditLogs = get(base + "/api/audit-logs", adminToken);
    assertThat(auditLogs.getStatusCode()).isEqualTo(HttpStatus.OK);
    List<Map<String, Object>> logs = (List<Map<String, Object>>) auditLogs.getBody().get("auditLogs");
    assertThat(logs).anyMatch(log -> "document.update_metadata".equals(log.get("action")));
    assertThat(logs).anyMatch(log -> "feedback.resolve".equals(log.get("action")));
    assertThat(logs).anyMatch(log -> "document.delete".equals(log.get("action")));

    ResponseEntity<String> report = getText(base + "/api/export/markdown?workspace=resume", adminToken);
    assertThat(report.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(report.getBody()).contains("## 知识空间", "## 文档清单", "摘要：", "## 反馈状态", "Java Resume Knowledge", "已修正反馈：1");
  }

  private String login(String base, String username, String password) {
    ResponseEntity<Map> response = rest.postForEntity(base + "/api/auth/login", Map.of("username", username, "password", password), Map.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    return String.valueOf(response.getBody().get("token"));
  }

  private Map<String, Object> upload(String base, String token, String filename, String content, String workspace) {
    ResponseEntity<Map> response = uploadResponse(base, token, filename, content, workspace);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    return response.getBody();
  }

  private ResponseEntity<Map> uploadResponse(String base, String token, String filename, String content, String workspace) {
    HttpHeaders headers = authHeaders(token);
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    body.add("title", filename);
    body.add("workspace", workspace);
    body.add("tags", "test,java");
    body.add("description", "integration test document");
    body.add("file", new ByteArrayResource(content.getBytes(StandardCharsets.UTF_8)) {
      @Override public String getFilename() { return filename; }
    });
    return rest.exchange(base + "/api/documents", HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
  }

  private ResponseEntity<Map> postJson(String url, String token, Map<String, Object> body) {
    HttpHeaders headers = authHeaders(token);
    headers.setContentType(MediaType.APPLICATION_JSON);
    return rest.exchange(url, HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
  }

  private ResponseEntity<Map> patchJson(String url, String token, Map<String, Object> body) {
    HttpHeaders headers = authHeaders(token);
    headers.setContentType(MediaType.APPLICATION_JSON);
    return rest.exchange(url, HttpMethod.PATCH, new HttpEntity<>(body, headers), Map.class);
  }

  private ResponseEntity<Map> get(String url, String token) {
    return rest.exchange(url, HttpMethod.GET, new HttpEntity<>(authHeaders(token)), Map.class);
  }

  private ResponseEntity<Map> delete(String url, String token) {
    return rest.exchange(url, HttpMethod.DELETE, new HttpEntity<>(authHeaders(token)), Map.class);
  }

  private ResponseEntity<String> getText(String url, String token) {
    return rest.exchange(url, HttpMethod.GET, new HttpEntity<>(authHeaders(token)), String.class);
  }

  private HttpHeaders authHeaders(String token) {
    HttpHeaders headers = new HttpHeaders();
    headers.setBearerAuth(token);
    return headers;
  }
}
