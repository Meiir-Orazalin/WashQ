export class RefreshRequestOriginPolicy {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(allowedOrigins: string[]) {
    this.allowedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  }

  isAllowed(origin: string | undefined): boolean {
    if (origin === undefined) {
      return true;
    }

    try {
      const normalizedOrigin = new URL(origin).origin;
      return normalizedOrigin === origin && this.allowedOrigins.has(normalizedOrigin);
    } catch {
      return false;
    }
  }
}
