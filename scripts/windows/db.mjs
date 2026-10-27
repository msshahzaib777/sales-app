// Database helper for scripts/windows/setup.ps1, so the setup needs no psql. Uses the `pg` driver
// the app already depends on. Connection details come from environment variables, not arguments.
//
//   node scripts/windows/db.mjs ensure   creates (or re-passwords) the app role and database
//     SALES_PG_SUPER_URL     superuser connection, e.g. postgresql://postgres:pw@localhost:5432/postgres
//     SALES_APP_DB_PASSWORD  password for the sales_app role (hex, from the setup script)
//
//   node scripts/windows/db.mjs set-super-password   sets the postgres superuser's password
//     SALES_PG_SUPER_URL       superuser connection (the installer's one-minute local trust)
//     SALES_PG_SUPER_PASSWORD  the password from settings.env (hex)
//
//   node scripts/windows/db.mjs reset    deletes the app database and role (fresh installation)
//     SALES_PG_SUPER_URL     superuser connection
//
//   node scripts/windows/db.mjs tenants  prints how many tenants exist (0 if the table is missing)
//     SALES_APP_DB_URL       the app's DATABASE_URL

import pg from "pg";

const command = process.argv[2];

async function connect(url) {
  // Right after PostgreSQL starts it may still say "starting up" for a few seconds.
  for (let attempt = 1; ; attempt++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const retry = /starting up|ECONNREFUSED|ECONNRESET/i.test(String(error?.message ?? error));
      if (!retry || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function withClient(url, body) {
  const client = await connect(url);
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

async function ensure() {
  const password = process.env.SALES_APP_DB_PASSWORD ?? "";
  if (!/^[0-9a-f]{16,}$/.test(password)) throw new Error("SALES_APP_DB_PASSWORD must be hex.");
  await withClient(process.env.SALES_PG_SUPER_URL, async (db) => {
    const role = await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'sales_app'");
    await db.query(
      `${role.rowCount ? "ALTER" : "CREATE"} ROLE sales_app WITH LOGIN PASSWORD '${password}'`,
    );
    const database = await db.query("SELECT 1 FROM pg_database WHERE datname = 'sales_app'");
    if (!database.rowCount) await db.query("CREATE DATABASE sales_app OWNER sales_app");
  });
  console.log("ok");
}

async function setSuperPassword() {
  const password = process.env.SALES_PG_SUPER_PASSWORD ?? "";
  if (!/^[0-9a-f]{16,}$/.test(password)) throw new Error("SALES_PG_SUPER_PASSWORD must be hex.");
  await withClient(process.env.SALES_PG_SUPER_URL, (db) =>
    db.query(`ALTER ROLE postgres WITH PASSWORD '${password}'`),
  );
  console.log("ok");
}

async function reset() {
  await withClient(process.env.SALES_PG_SUPER_URL, async (db) => {
    const database = await db.query("SELECT 1 FROM pg_database WHERE datname = 'sales_app'");
    // FORCE closes any connection still open (e.g. a website window left running).
    if (database.rowCount) await db.query("DROP DATABASE sales_app WITH (FORCE)");
    await db.query("DROP ROLE IF EXISTS sales_app");
  });
  console.log("ok");
}

async function tenants() {
  await withClient(process.env.SALES_APP_DB_URL, async (db) => {
    const table = await db.query("SELECT to_regclass('public.\"Tenant\"') AS t");
    if (!table.rows[0].t) return console.log("0");
    const { rows } = await db.query('SELECT count(*)::int AS n FROM "Tenant"');
    console.log(String(rows[0].n));
  });
}

try {
  if (command === "ensure") await ensure();
  else if (command === "reset") await reset();
  else if (command === "set-super-password") await setSuperPassword();
  else if (command === "tenants") await tenants();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
