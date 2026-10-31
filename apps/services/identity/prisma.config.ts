import { defineConfig } from 'prisma/config';

// Prisma CLI configuration (generate, migrate). The running service connects with
// DATABASE_URL instead, as the less privileged identity_app role.
// Env vars come from Nx, which loads the project's .env for the identity:prisma* targets.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Optional so that `prisma generate` works without a database (CI builds)
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
