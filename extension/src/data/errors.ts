/**
 * Typed failures for the data-pack pipeline. Callers switch on `code`; the
 * message is intended for logs and user-facing summaries, never for parsing.
 */
export class DataError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class CatalogueError extends DataError {}

export class ManifestError extends DataError {}

export class TarError extends DataError {}

export class DownloadError extends DataError {}

export class PackStoreError extends DataError {}
