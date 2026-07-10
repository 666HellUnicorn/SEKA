FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
ENV SEKA_JAVA_DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/seka-java-backend-0.2.0.jar /app/seka-java-backend.jar
EXPOSE 8865
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:8865/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "/app/seka-java-backend.jar"]
