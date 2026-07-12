/**
 * Redacting logger (PR8/SD3). Every message and every structured field passes through
 * the value-based {@link SecretScrubber} BEFORE it reaches any sink — redaction is on by
 * default and is NOT a debug/verbose feature.
 *
 * SD3 invariant: verbose logging is OFF by default and enabling it changes ONLY whether
 * `debug` records are emitted. Verbose never disables redaction — a secret is scrubbed at
 * every level, verbose on or off. There is no code path that emits an un-scrubbed record.
 */

import type { SecretScrubber } from "./secret-scrubber.js";

export type LogLevel = "error" | "warn" | "info" | "debug";

/** A single emitted log record. Its `message`/`fields` are ALWAYS already scrubbed. */
export interface LogRecord {
  readonly level: LogLevel;
  /** ISO-8601 timestamp. */
  readonly at: string;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** Where scrubbed records go. Swap in a buffer sink for tests / the diagnostics bundle. */
export type LogSink = (record: LogRecord) => void;

export interface RedactingLoggerOptions {
  readonly scrubber: SecretScrubber;
  /** Defaults to {@link consoleSink}. */
  readonly sink?: LogSink;
  /** Verbose (debug) emission. Defaults to `false` (off by default). */
  readonly verbose?: boolean;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

export interface RedactingLogger {
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  /** Emitted ONLY when verbose is on — but still fully redacted when it is. */
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  /** Toggle verbose (debug) emission. Never affects redaction of any level. */
  setVerbose(on: boolean): void;
  readonly verbose: boolean;
}

class RedactingLoggerImpl implements RedactingLogger {
  private readonly scrubber: SecretScrubber;
  private readonly sink: LogSink;
  private readonly now: () => Date;
  private verboseOn: boolean;

  constructor(options: RedactingLoggerOptions) {
    this.scrubber = options.scrubber;
    this.sink = options.sink ?? consoleSink;
    this.now = options.now ?? (() => new Date());
    this.verboseOn = options.verbose ?? false;
  }

  get verbose(): boolean {
    return this.verboseOn;
  }

  setVerbose(on: boolean): void {
    this.verboseOn = on;
  }

  error(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.emit("error", message, fields);
  }

  warn(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.emit("warn", message, fields);
  }

  info(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.emit("info", message, fields);
  }

  debug(message: string, fields?: Readonly<Record<string, unknown>>): void {
    // The ONLY effect of verbose: gate debug emission. Redaction below is unconditional.
    if (!this.verboseOn) return;
    this.emit("debug", message, fields);
  }

  private emit(
    level: LogLevel,
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    // Redaction happens here for EVERY level — there is no un-scrubbed branch. `emit` must
    // never throw due to field shape (a circular request/socket/error-cause graph would
    // otherwise crash the loopback service): `scrubDeep` is cycle-safe, and the guard below
    // degrades a pathological field graph to a safe placeholder rather than propagating.
    const base = { level, at: this.now().toISOString(), message: this.scrubber.scrub(message) };
    const record: LogRecord =
      fields === undefined ? base : { ...base, fields: this.scrubFields(fields) };
    this.sink(record);
  }

  private scrubFields(
    fields: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    try {
      return this.scrubber.scrubDeep(fields);
    } catch {
      return { diagnostics: "[unredactable fields — omitted]" };
    }
  }
}

/** Default sink: write scrubbed records to the console. Records are already redacted. */
export function consoleSink(record: LogRecord): void {
  const line = record.fields
    ? `${record.at} [${record.level}] ${record.message} ${JSON.stringify(record.fields)}`
    : `${record.at} [${record.level}] ${record.message}`;
  // eslint-disable-next-line no-console -- the single sanctioned log egress point.
  (record.level === "error" || record.level === "warn" ? console.error : console.log)(line);
}

/** A sink that retains records in memory (for tests + the diagnostics bundle export). */
export interface BufferSink {
  readonly sink: LogSink;
  /** A copy of the retained records. */
  records(): LogRecord[];
  clear(): void;
}

export function createBufferSink(): BufferSink {
  const buffer: LogRecord[] = [];
  return {
    sink: (record) => {
      buffer.push(record);
    },
    records: () => [...buffer],
    clear: () => {
      buffer.length = 0;
    },
  };
}

export function createRedactingLogger(options: RedactingLoggerOptions): RedactingLogger {
  return new RedactingLoggerImpl(options);
}
