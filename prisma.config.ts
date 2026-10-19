/// <reference types="node" />
import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads the connection URL from schema.prisma or loads .env automatically.
// The URL is used by the CLI (migrate, db execute, studio); the app connects via the driver adapter in app/db.server.js.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!process.env.DATABASE_HOST) return undefined;

  const {
    DATABASE_USER = "",
    DATABASE_PASSWORD = "",
    DATABASE_HOST,
    DATABASE_PORT = "3306",
    DATABASE_NAME = "",
    DATABASE_SSL_MODE = "DISABLED",
    DATABASE_SSL_CA,
  } = process.env;

  const url = new URL(`mysql://${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`);
  url.username = encodeURIComponent(DATABASE_USER);
  url.password = encodeURIComponent(DATABASE_PASSWORD);
  if (DATABASE_SSL_MODE.toUpperCase() !== "DISABLED" && DATABASE_SSL_CA) {
    url.searchParams.set("sslcert", path.resolve(DATABASE_SSL_CA));
    url.searchParams.set("sslaccept", "strict");
  }
  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl(),
  },
});
