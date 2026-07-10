package com.seka;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class OpenApiConfig {
  @Bean
  OpenAPI sekaOpenApi() {
    return new OpenAPI()
        .info(new Info()
            .title("SEKA Java Backend API")
            .version("0.2.0")
            .description("Spring Boot version of SEKA local knowledge-agent backend: RBAC, workspace isolation, document ingestion, retrieval, feedback workflow, audit logs and Markdown export.")
            .license(new License().name("MIT")))
        .schemaRequirement("bearerAuth", new SecurityScheme()
            .type(SecurityScheme.Type.HTTP)
            .scheme("bearer")
            .bearerFormat("Opaque token"))
        .addSecurityItem(new SecurityRequirement().addList("bearerAuth"));
  }
}
