import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://spatialchat:spatialchat@localhost:5432/spatialchat_test?schema=public";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.CLIENT_ORIGINS = "http://localhost:5173";
process.env.SMTP_HOST = "";
process.env.DISABLE_RATE_LIMITS = "true";
