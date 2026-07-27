import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

config({ path: '../../.env', quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.NODE_ENV === 'test' ? env('TEST_DATABASE_URL') : env('DATABASE_URL'),
  },
});
