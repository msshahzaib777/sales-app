// Point the app's Prisma client at the test database before any test module imports it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
