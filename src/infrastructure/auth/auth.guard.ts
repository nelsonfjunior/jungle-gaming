import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Observable } from "rxjs";

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers["authorization"];

    // Se fornecido token Bearer, armazena a identidade simulada no request
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      request["provider"] = {
        providerId: request.body?.providerId || "authenticated-provider",
        token,
      };
    }

    // Ponto de extensão no-op conforme Seção 2 do edital (autenticação a cargo do candidato)
    return true;
  }
}

