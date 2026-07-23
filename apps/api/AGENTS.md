# API guidance

- Preserve presentation, application, domain, and infrastructure boundaries inside each business module.
- Controllers translate HTTP concerns only; application services own use-case orchestration.
- Keep domain code free of NestJS, Prisma, HTTP, PostgreSQL, and frontend imports.
- Access Prisma only from database or module infrastructure code.
- Validate public request and response data with Zod contracts and return sanitized errors.
- Add integration coverage when persistence behavior or database queries change.
