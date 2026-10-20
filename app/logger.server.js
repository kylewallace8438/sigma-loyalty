import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// pino resolves transport names relative to the calling file, which fails under Vite's SSR
// module runner ("unable to determine transport target"). Resolve them from the project root.
const resolveTarget = createRequire(path.resolve("package.json")).resolve;

const LOG_FILE_PATTERN = /^app\.(\d{4}-\d{2}-\d{2})\.\d+\.log$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deletes rotated files whose filename date is older than `retentionDays`.
// pino-roll can only cap the number of files (and only those written by the current process),
// so age-based retention is done here: once at startup, then daily.
function pruneOldLogs(dir, retentionDays, logger) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS).toISOString().slice(0, 10);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const file of files) {
    const date = file.match(LOG_FILE_PATTERN)?.[1];
    if (!date || date >= cutoff) continue;
    try {
      fs.unlinkSync(path.join(dir, file));
      logger.info({ file, retentionDays }, "Deleted old log file");
    } catch (err) {
      logger.warn({ err, file }, "Could not delete old log file");
    }
  }
}

// LOG_FILE=false disables file logging; otherwise logs are written to LOG_DIR as
// app.<yyyy-MM-dd>.<n>.log, rotated daily (or at 20 MB), with logs/current.log pointing at the
// active file. Files older than LOG_RETENTION_DAYS (default 30) are deleted.
function createLogger() {
  const level = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");
  const targets = [
    isProduction
      ? { target: resolveTarget("pino/file"), level, options: { destination: 1 } }
      : {
          target: resolveTarget("pino-pretty"),
          level,
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
  ];

  const logDir = path.resolve(process.env.LOG_DIR || "logs");
  const fileLogging = process.env.LOG_FILE !== "false";
  if (fileLogging) {
    targets.push({
      target: resolveTarget("pino-roll"),
      level,
      options: {
        file: path.join(logDir, "app.log"),
        frequency: "daily",
        dateFormat: "yyyy-MM-dd",
        size: "20m",
        symlink: true,
        mkdir: true,
      },
    });
  }

  const logger = pino({ level, transport: { targets } });

  if (fileLogging) {
    const retentionDays = Number(process.env.LOG_RETENTION_DAYS) || 30;
    pruneOldLogs(logDir, retentionDays, logger);
    setInterval(() => pruneOldLogs(logDir, retentionDays, logger), DAY_MS).unref();
  }

  return logger;
}

// Reuse one logger across dev hot reloads so transport worker threads aren't leaked.
if (!isProduction && !global.loggerGlobal) {
  global.loggerGlobal = createLogger();
}

const logger = global.loggerGlobal ?? createLogger();

export default logger;
