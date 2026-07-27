import { environmentSchema } from './environment.js';

export function applicationConfiguration() {
  const environment = environmentSchema.parse(process.env);

  return {
    application: {
      nodeEnv: environment.NODE_ENV,
      port: environment.API_PORT,
      corsOrigins: environment.CORS_ORIGINS,
      logLevel: environment.LOG_LEVEL,
      docsEnabled: environment.API_DOCS_ENABLED,
    },
    database: {
      url: environment.DATABASE_URL,
    },
    authentication: {
      accessTokenSigningSecret: environment.ACCESS_TOKEN_SIGNING_SECRET,
      accessTokenLifetimeSeconds: environment.ACCESS_TOKEN_LIFETIME_SECONDS,
      refreshTokenLifetimeSeconds: environment.REFRESH_TOKEN_LIFETIME_SECONDS,
    },
  };
}
