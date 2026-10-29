import { createHash } from "crypto";

export class CanonicalJsonHasher {
  /**
   * Ordena recursivamente as chaves de um objeto para garantir JSON canônico determinístico.
   */
  public static sortKeys(obj: any): any {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortKeys(item));
    }

    const sortedObj: Record<string, any> = {};
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
      if (obj[key] !== undefined) {
        sortedObj[key] = this.sortKeys(obj[key]);
      }
    }

    return sortedObj;
  }

  /**
   * Gera o hash SHA-256 do JSON canônico para o subconjunto de negócio.
   */
  public static hash(data: Record<string, any>): string {
    const sorted = this.sortKeys(data);
    const canonicalString = JSON.stringify(sorted);
    return createHash("sha256").update(canonicalString).digest("hex");
  }
}

