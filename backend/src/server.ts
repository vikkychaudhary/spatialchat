import { prisma } from "./db";
import { createApp } from "./app";
import { env } from "./env";
import { log } from "./logger";

const { httpServer, io } = createApp();

// Housekeeping: expired sessions and used/expired reset tokens are not retained.
async function cleanup() {
  const now = new Date();
  const [s, t] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } }),
  ]);
  if (s.count || t.count) log.info(`cleanup removed ${s.count} sessions and ${t.count} reset tokens`);
}
const timer = setInterval(() => void cleanup().catch((e) => log.error("cleanup failed", e)), 3600_000);
timer.unref();
void cleanup().catch((e) => log.error("cleanup failed", e));

httpServer.listen(env.PORT, () => log.info(`SpatialChat API listening on :${env.PORT} (${env.NODE_ENV})`));

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  clearInterval(timer);
  io.close();
  httpServer.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
