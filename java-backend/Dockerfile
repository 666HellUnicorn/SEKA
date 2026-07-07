FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
ENV SEKA_DATA_DIR=/data
COPY --from=build /app/target/seka-java-backend-0.2.0.jar /app/seka-java-backend.jar
EXPOSE 8865
VOLUME ["/data"]
ENTRYPOINT ["java", "-jar", "/app/seka-java-backend.jar"]
