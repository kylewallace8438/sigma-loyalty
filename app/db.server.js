import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// Prisma 7 requires a driver adapter; @prisma/adapter-mariadb is the MySQL adapter.
function createAdapter() {
  const sslEnabled =
    (process.env.DATABASE_SSL_MODE || "DISABLED").toUpperCase() !== "DISABLED";
  const sslCa = process.env.DATABASE_SSL_CA;
  const ssl = sslEnabled
    ? sslCa
      ? { ca: fs.readFileSync(path.resolve(sslCa)), rejectUnauthorized: true }
      : true
    : undefined;

  return new PrismaMariaDb({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl,
    // MySQL 8's caching_sha2_password needs the server's RSA key when the connection isn't encrypted.
    allowPublicKeyRetrieval: !sslEnabled,
    connectionLimit: 5,
  });
}

function createPrismaClient() {
  return new PrismaClient({ adapter: createAdapter() });
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
