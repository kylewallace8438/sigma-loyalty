import { createRequire } from "node:module";
import path from "node:path";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// pino resolves transport names relative to the calling file, which fails under Vite's SSR
// module runner ("unable to determine transport target"). Resolve them from the project root.
const resolveTarget = createRequire(path.resolve("package.json")).resolve;

// LOG_FILE=false disables file logging; otherwise logs are written to LOG_DIR as
// app.<yyyy-MM-dd>.<n>.log, rotated daily, with logs/current.log pointing at the active file.
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

  if (process.env.LOG_FILE !== "false") {
    targets.push({
      target: resolveTarget("pino-roll"),
      level,
      options: {
        file: path.resolve(process.env.LOG_DIR || "logs", "app.log"),
        frequency: "daily",
        dateFormat: "yyyy-MM-dd",
        size: "20m",
        limit: { count: 14 },
        symlink: true,
        mkdir: true,
      },
    });
  }

  return pino({ level, transport: { targets } });
}

// Reuse one logger across dev hot reloads so transport worker threads aren't leaked.
if (!isProduction && !global.loggerGlobal) {
  global.loggerGlobal = createLogger();
}

const logger = global.loggerGlobal ?? createLogger();

export default logger;
