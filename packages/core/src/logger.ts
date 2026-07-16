import { pino, type Logger } from "pino";

export type { Logger };

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
