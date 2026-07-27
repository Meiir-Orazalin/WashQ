export const REFRESH_TOKEN_GENERATOR = Symbol('REFRESH_TOKEN_GENERATOR');

export interface RefreshTokenGenerator {
  generate(): string;
}
