/**
 * HTTP boundary helpers: bounded JSON body reading and versioned envelope writing.
 * Kept separate from the server wiring so both stay small and testable.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BOUNDARY_PROTOCOL_VERSION,
  type BoundaryError,
  type BoundaryErrorCode,
  type ErrorEnvelope,
  type ResponseEnvelope,
  type SuccessEnvelope,
} from "../boundary/contract.js";

export class PayloadTooLargeError extends Error {
  readonly code = "payload_too_large";
  constructor(maxBytes: number) {
    super(`Request body exceeded ${maxBytes} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

export class InvalidJsonBodyError extends Error {
  readonly code = "bad_request";
  constructor() {
    super("Request body is not valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

/**
 * A handler-raised malformed-request error. The dispatcher maps it to `bad_request` (HTTP 400)
 * and surfaces its message, so a route validating its own body (e.g. a missing required field)
 * returns 400 instead of a misleading 500. The message MUST stay generic — never a path/secret.
 */
export class BadRequestError extends Error {
  readonly code = "bad_request";
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Read and parse a JSON body with a hard byte cap. Bodyless/empty requests → undefined. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new PayloadTooLargeError(maxBytes);
    chunks.push(buf);
  }
  if (total === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data };
}

export function errorEnvelope(code: BoundaryErrorCode, message: string): ErrorEnvelope {
  const error: BoundaryError = { code, message };
  return { protocol: BOUNDARY_PROTOCOL_VERSION, ok: false, error };
}

/** Serialize and send a versioned envelope. Sets loopback-appropriate headers. */
export function writeEnvelope<T>(
  res: ServerResponse,
  status: number,
  envelope: ResponseEnvelope<T>,
): void {
  const payload = JSON.stringify(envelope);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}
