import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { CORRELATION_ID_HEADER } from "../middlewares/correlation-id.middleware";

@Injectable()
export class StructuredLoggerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const start = Date.now();

    const correlationId = req.headers[CORRELATION_ID_HEADER];
    const { method, url, body } = req;

    // Extrai identificadores de contexto para observabilidade
    const walletId = req.params?.walletId || body?.walletId;
    const providerId = req.params?.providerId || body?.providerId;
    const transactionId = req.params?.transactionId || body?.externalTransactionId;

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - start;
          const logPayload = {
            timestamp: new Date().toISOString(),
            level: "INFO",
            correlationId,
            walletId,
            providerId,
            transactionId,
            method,
            url,
            statusCode: res.statusCode,
            durationMs,
          };
          console.log(JSON.stringify(logPayload));
        },
        error: (err) => {
          const durationMs = Date.now() - start;
          const logPayload = {
            timestamp: new Date().toISOString(),
            level: "ERROR",
            correlationId,
            walletId,
            providerId,
            transactionId,
            method,
            url,
            statusCode: err.status || 500,
            durationMs,
            errorMessage: err.message,
          };
          console.error(JSON.stringify(logPayload));
        },
      }),
    );
  }
}

