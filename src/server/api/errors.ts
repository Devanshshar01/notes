import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/server/auth/auth-context";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const NoteConflictError = (
  currentRevision: number,
  expectedRevision: number,
) =>
  new HttpError(
    409,
    "stale_revision",
    "Note was updated by someone else. Reload and retry.",
    { currentRevision, expectedRevision },
  );

export function errorToResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof HttpError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof AuthError) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: err.message } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Invalid request",
          details: err.flatten(),
        },
      },
      { status: 422 },
    );
  }

  console.error("[api] unexpected error", err);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Internal server error" } },
    { status: 500 },
  );
}
