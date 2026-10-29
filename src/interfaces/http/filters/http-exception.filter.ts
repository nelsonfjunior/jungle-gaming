import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import {
  IdempotencyConflictError,
  TransactionNotFoundError,
  WalletConflictError,
  WalletNotFoundError,
} from "../../../application/errors/application.error";
import {
  CurrencyMismatchError,
  DomainError,
  InvalidMoneyError,
} from "../../../domain/errors/domain.error";

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code = "INTERNAL_SERVER_ERROR";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();
      message = typeof res === "object" ? res.message || res : res;
      code = "HTTP_EXCEPTION";
    } else if (
      exception instanceof WalletConflictError ||
      exception instanceof IdempotencyConflictError
    ) {
      status = HttpStatus.CONFLICT;
      message = (exception as Error).message;
      code = "CONFLICT";
    } else if (
      exception instanceof WalletNotFoundError ||
      exception instanceof TransactionNotFoundError
    ) {
      status = HttpStatus.NOT_FOUND;
      message = (exception as Error).message;
      code = "NOT_FOUND";
    } else if (
      exception instanceof InvalidMoneyError ||
      exception instanceof CurrencyMismatchError
    ) {
      status = HttpStatus.BAD_REQUEST;
      message = (exception as Error).message;
      code = "INVALID_INPUT";
    } else if (exception instanceof DomainError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = (exception as Error).message;
      code = "DOMAIN_ERROR";
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      statusCode: status,
      error: code,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
