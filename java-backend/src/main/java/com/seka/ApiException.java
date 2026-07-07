package com.seka;

class ApiException extends RuntimeException {
  private final int status;
  ApiException(int status, String message) {
    super(message);
    this.status = status;
  }
  int status() { return status; }
}
