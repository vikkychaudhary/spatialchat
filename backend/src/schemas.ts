import { z } from "zod";

export const uuid = z.string().uuid();
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "Username must be 3-24 characters: letters, numbers or underscores");
export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
// Max length protects Argon2 from huge-input denial of service.
export const password = z.string().min(10, "Password must be at least 10 characters").max(128, "Password is too long");
export const displayName = z.string().trim().min(1, "Display name is required").max(50);
export const statusText = z.string().trim().max(100);
export const avatarColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color");
export const messageBody = z.string().trim().min(1, "Message can't be empty").max(4000, "Message is too long (max 4000 characters)");

export const registerSchema = z.object({ username, email, displayName: displayName.optional(), password });
export const loginSchema = z.object({ identifier: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(128) });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });
export const profileSchema = z.object({ displayName: displayName.optional(), status: statusText.optional(), avatarColor: avatarColor.optional() });
export const settingsSchema = z.object({
  showLastSeen: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  desktopEnabled: z.boolean().optional(),
  previewsEnabled: z.boolean().optional(),
});
export const sendMessageSchema = z.object({
  conversationId: uuid,
  clientId: z.string().uuid("clientId must be a UUID"),
  body: messageBody,
  replyToId: uuid.optional().nullable(),
});
export const searchSchema = z.object({
  q: z.string().trim().min(3, "Type at least 3 characters").max(50).transform((s) => s.replace(/[%\\]/g, "")),
  cursor: z.string().max(24).optional(),
});
