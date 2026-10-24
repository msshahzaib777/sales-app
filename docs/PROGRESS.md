# Progress

Running log of what has been built, decisions taken, and open items. Newest first.

## Task 1: Project setup — done

**Built**

- Next.js 16 (App Router) + TypeScript strict, pnpm 10, Tailwind CSS 4.
- shadcn/ui configured by hand (`components.json`, theme tokens in `src/app/globals.css`, `cn`
  helper in `src/lib/utils.ts`, `Button` component), because the shadcn registry was unreachable
  from the build environment. The CLI works for adding more components on a normal network.
- Prisma 7 with PostgreSQL through the `@prisma/adapter-pg` driver adapter. Config lives in
  `prisma.config.ts`; the client is generated to `src/generated/prisma` (git-ignored, regenerated
  on `pnpm install`). The raw client in `src/server/db/client.ts` is marked `server-only`.
- Bootstrap schema with only a `Tenant` table and an `init` migration, plus a seed script that
  upserts a demo tenant. The full Phase 1 schema comes in Task 2.
- Zod installed (used from Task 2 onward).
- Vitest with `@/` path aliases; first unit tests cover half-dozen quantity conversion
  (`src/lib/units.ts`).
- ESLint (Next.js core-web-vitals + TypeScript) with `eslint-config-prettier`; Prettier with the
  Tailwind class-sorting plugin. Spec documents and `CLAUDE.md` are excluded from Prettier.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `format`, `db:migrate`,
  `db:deploy`, `db:seed`, `db:generate`, `db:studio`.
- App shell: left sidebar (Dashboard, Orders, Delivery, Purchases, Inventory, Customers,
  Companies, Payments, Expenses, Reports, Settings) with active-link highlighting; `/` redirects
  to `/dashboard`; each section has an empty placeholder page. Pages are server components; only
  the nav list is a small client component (for the active link). The sidebar is hidden when
  printing.
- README with local setup steps, and `.env.example`.

**Verified:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:migrate` and
`pnpm db:seed` pass against a local PostgreSQL 16.

**Open / next**

- Task 2: full Prisma schema and realistic seed (2 warehouses, 3 companies, 20 products,
  30 customers, 4 bikes).
- Task 3: Auth.js login, `src/server/db/tenant.ts` tenant-scoped data layer, permissions, audit
  log helper. Pages are not protected until then.
- Playwright is not installed yet; add it with the first key flow (login / order entry).
- No CI workflow yet; consider a GitHub Action running lint, typecheck and test.
