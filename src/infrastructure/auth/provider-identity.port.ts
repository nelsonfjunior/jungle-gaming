export interface AuthenticatedProvider {
  providerId: string;
  clientId: string;
  scopes: string[];
}

export interface ProviderIdentityPort {
  /**
   * Valida as credenciais ou token emitido pelo Identity Provider externo (Keycloak/Zitadel).
   */
  authenticate(token: string): Promise<AuthenticatedProvider>;
}

