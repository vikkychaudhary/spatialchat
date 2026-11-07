import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { log } from "./logger";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You are not allowed to do that") => new HttpError(403, "forbidden", msg);

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
/** Express 4 does not catch rejected promises; this forwards them to the error middleware. */
export const wrap = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  fn(req, res, next).catch(next);
};

export function toErrorBody(err: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (err instanceof HttpError) return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    return { status: 400, body: { error: { code: "validation_error", message: details[0]?.message ?? "Invalid input", details } } };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { status: 409, body: { error: { code: "conflict", message: "That already exists" } } };
  }
  return { status: 500, body: { error: { code: "internal_error", message: "Something went wrong on our side" } } };
}

export const errorMiddleware = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const entityTooLarge = typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.too.large";
  const parseFail = typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.parse.failed";
  const { status, body } = entityTooLarge
    ? { status: 413, body: { error: { code: "too_large", message: "Request is too large" } } }
    : parseFail
      ? { status: 400, body: { error: { code: "bad_json", message: "Invalid JSON" } } }
      : toErrorBody(err);
  if (status >= 500) log.error(`${req.method} ${req.path} failed`, err); // path only, no query/body
  res.status(status).json(body);
};
