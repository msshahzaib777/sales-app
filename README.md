# Sales App

Multi-tenant distribution management for product distributors: orders, delivery, stock,
purchasing, payments, ledgers, expenses and reports. Requirements are in
[`docs/SPEC.md`](docs/SPEC.md); architecture rules for contributors are in [`CLAUDE.md`](CLAUDE.md);
build status is in [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Stack

Next.js (App Router) · TypeScript (strict) · PostgreSQL + Prisma 7 · Tailwind CSS 4 + shadcn/ui ·
Zod · Vitest · ESLint + Prettier · pnpm

## Local setup

Prerequisites: Node.js 20.19+ (22 LTS recommended), pnpm 10, and PostgreSQL 14+ (local install,
Docker, or a free Neon/Supabase database).

1. **Install dependencies** (also generates the Prisma client):

   ```bash
   pnpm install
   ```

2. **Create a database.** For example, with Docker:

   ```bash
   docker run -d --name sales-db -p 5432:5432 \
     -e POSTGRES_USER=sales -e POSTGRES_PASSWORD=sales -e POSTGRES_DB=sales_app postgres:16
   ```

3. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `DATABASE_URL` in `.env` if your database differs from the default.

4. **Run migrations and seed demo data:**

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

5. **Start the dev server:**

   ```bash
   pnpm dev
   ```

   Open <http://localhost:3000>.

## Scripts

| Script             | What it does                                             |
| ------------------ | -------------------------------------------------------- |
| `pnpm dev`         | Start the dev server                                     |
| `pnpm build`       | Production build                                         |
| `pnpm start`       | Serve the production build                               |
| `pnpm lint`        | ESLint                                                   |
| `pnpm typecheck`   | Generate route types and run `tsc --noEmit`              |
| `pnpm test`        | Run Vitest unit tests once                               |
| `pnpm format`      | Format with Prettier (`format:check` to verify only)     |
| `pnpm db:migrate`  | Create/apply migrations in development                   |
| `pnpm db:deploy`   | Apply migrations in production (`prisma migrate deploy`) |
| `pnpm db:seed`     | Seed the demo tenant                                     |
| `pnpm db:generate` | Regenerate the Prisma client                             |
| `pnpm db:studio`   | Open Prisma Studio                                       |

Before opening a PR, run `pnpm lint`, `pnpm typecheck` and `pnpm test`.

## Project layout

```
prisma/                 schema, migrations, seed script
prisma.config.ts        Prisma CLI config (datasource URL, seed command)
src/app/(app)/          app pages sharing the sidebar layout
src/components/ui/      shadcn/ui components
src/components/layout/  sidebar and page shell
src/lib/                shared helpers (e.g. half-dozen quantity conversion)
src/server/db/          Prisma client; the tenant-scoped data layer goes here
src/server/services/    business logic with unit tests
src/generated/prisma/   generated Prisma client (git-ignored)
```

## Adding shadcn/ui components

`components.json` is configured, so `pnpm dlx shadcn@latest add <component>` works on a normal
network. Components land in `src/components/ui`.

## Deployment

Target is Vercel + managed Postgres (Neon or Supabase). Set `DATABASE_URL` (and `AUTH_SECRET`
once auth lands) in the Vercel project, and run `pnpm db:deploy` as part of each release.
