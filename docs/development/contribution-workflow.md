# Contribution workflow

1. Read the relevant product, architecture, ADR, and `AGENTS.md` files.
2. Create a short-lived branch from `main`.
3. Identify module ownership and public contracts before editing.
4. Implement the smallest vertical behavior with its tests.
5. Update documentation and migrations when required.
6. Run the definition-of-done checks locally.
7. Open a pull request describing intent, architecture impact, test evidence,
   migration/rollback considerations, and known risks.

Authentication changes additionally run the built-app Chromium smoke suite on
pull requests. Pushes to `main`, manual runs, and the bounded weekly schedule
run the full Chromium/WebKit authentication lifecycle matrix. A failed focused
browser run must include safe artifact evidence and successful namespaced
fixture cleanup; reruns do not replace investigation of the first failure.

Commits should be focused and use imperative summaries. Never commit `.env`,
database dumps, credentials, access tokens, generated Prisma Client output,
build output, or test artifacts.

Applied migrations are immutable. A correction is a new migration. Schema
changes that can remove or reinterpret data require an explicit rollout plan in
the pull request.
