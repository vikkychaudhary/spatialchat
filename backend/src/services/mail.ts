import nodemailer from "nodemailer";
import { env } from "../env";
import { log } from "../logger";

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

export async function sendPasswordResetEmail(to: string, link: string): Promise<void> {
  const t = getTransport();
  if (!t) {
    log.warn("SMTP_HOST is not configured; password reset email was not sent");
    return;
  }
  await t.sendMail({
    from: env.MAIL_FROM,
    to,
    subject: "Reset your SpatialChat password",
    text: `Use this link to choose a new password. It expires in 30 minutes and works once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
  });
}
