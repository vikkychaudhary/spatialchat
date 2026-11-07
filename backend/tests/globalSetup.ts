import { execSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";

export const DEFAULT_TEST_DB = "postgresql://spatialchat:spatialchat@localhost:5432/spatialchat_test?schema=public";

/** Applies migrations to the TEST database once before the suite. Never touches DATABASE_URL. */
export default function setup() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;
  execSync("npx prisma migrate deploy", { cwd: path.resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
