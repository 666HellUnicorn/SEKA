package com.seka;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
class ApiExceptionHandler {
  @ExceptionHandler(ApiException.class)
  ResponseEntity<Map<String, Object>> api(ApiException error) {
    return ResponseEntity.status(error.status()).body(Map.of("error", error.getMessage()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException error) {
    Map<String, String> validationErrors = new LinkedHashMap<>();
    error.getBindingResult().getFieldErrors().forEach(fieldError ->
        validationErrors.put(fieldError.getField(), fieldError.getDefaultMessage()));
    return ResponseEntity.badRequest().body(Map.of(
        "error", "请求参数校验失败",
        "validationErrors", validationErrors
    ));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> generic(Exception error) {
    return ResponseEntity.status(500).body(Map.of("error", error.getMessage()));
  }
}
