/*
 * Local-only recovery drafts for MonacoAnywhere.
 *
 * IndexedDB database `monacoanywhere` v1 holds one `drafts` store keyed by a
 * deterministic SHA-256 of originKey|accountScope|problemKey|editorSlot.
 *
 * There is no network use and no site upload. Content writes are debounced
 * (500 ms by default), serialized per record, and guarded by a short heartbeat
 * lease. Two tabs editing the same key get an explicit conflict carrying both
 * read-only previews; resolving it requires a deliberate choice. A crashed or
 * reloaded tab leaves a lease that becomes stale after leaseTtlMs (20 s), so a
 * lock can never survive permanently.
 *
 * Records written here additionally carry revision/writerId/heartbeatAt lease
 * metadata. They do not change the required record fields.
 */

export interface DraftKeyParts {
  originKey: string;
  accountScope: string;
  problemKey: string;
  editorSlot: string;
}

export interface DraftRecord {
  k: string;
  code: string;
  languageOptionId: string | null;
  updatedAt: number;
  siteEditorValue: string | null;
  baseSiteValue: string | null;
  revision: number;
  writerId: string;
  heartbeatAt: number;
}

/** Display-only payload for compare dialogs; excludes lease metadata. */
export interface DraftPreview {
  code: string;
  languageOptionId: string | null;
  updatedAt: number;
  siteEditorValue: string | null;
  baseSiteValue: string | null;
}

/** Build an immutable read-only preview of a stored or pending draft. */
export function draftPreview(record: DraftRecord): Readonly<DraftPreview> {
  return Object.freeze({
    code: record.code,
    languageOptionId: record.languageOptionId,
    updatedAt: record.updatedAt,
    siteEditorValue: record.siteEditorValue,
    baseSiteValue: record.baseSiteValue
  });
}

export interface DraftSaveInput {
  code: string;
  languageOptionId?: string | null;
  siteEditorValue?: string | null;
  baseSiteValue?: string | null;
}

export interface DraftMutationDecision {
  put?: DraftRecord;
  delete?: boolean;
}

export interface DraftMutationResult {
  record: DraftRecord | null;
  changed: boolean;
}

export interface DraftStore {
  get(key: string): Promise<DraftRecord | null>;
  /**
   * Atomically read the current record, run `decide` once, then apply its
   * put/delete. `decide` must be synchronous; IndexedDB transactions make the
   * read-write pair serial across tabs.
   */
  mutate(
    key: string,
    decide: (current: DraftRecord | null) => DraftMutationDecision
  ): Promise<DraftMutationResult>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export type DraftConflictChoice = "this-page" | "other-page" | "newer";

export interface DraftConflict {
  key: string;
  local: DraftRecord;
  remote: DraftRecord;
  newer: "local" | "remote";
  reason: "remote-changed" | "lease-held";
  otherWriterActive: boolean;
}

export type DraftSaveResult =
  | { status: "saved"; record: DraftRecord; wrote: boolean }
  | { status: "conflict"; conflict: DraftConflict };

export type DraftSessionEvent =
  | { type: "saved"; record: DraftRecord; wrote: boolean }
  | { type: "conflict"; conflict: DraftConflict }
  | {
      type: "remote-change";
      revision: number;
      updatedAt: number;
      writerId: string;
    }
  | { type: "lease-lost" };

export interface DraftSessionOptions {
  store?: DraftStore;
  writerId?: string;
  now?: () => number;
  debounceMs?: number;
  leaseTtlMs?: number;
  heartbeatMs?: number;
  autoLifecycle?: boolean;
  broadcast?: boolean;
  onError?: (error: unknown) => void;
}

export interface DraftSession {
  readonly key: string;
  readonly writerId: string;
  load(): Promise<DraftRecord | null>;
  adopt(record: DraftRecord | null): void;
  scheduleSave(input: DraftSaveInput): void;
  hasPending(): boolean;
  flush(): Promise<DraftSaveResult | null>;
  cancel(): void;
  saveNow(input: DraftSaveInput): Promise<DraftSaveResult>;
  resolve(
    conflict: DraftConflict,
    choice: DraftConflictChoice
  ): Promise<DraftSaveResult>;
  subscribe(callback: (event: DraftSessionEvent) => void): () => void;
  deleteDraft(): Promise<void>;
  release(): void;
}

export const DRAFT_DB_NAME = "monacoanywhere";
export const DRAFT_DB_VERSION = 1;
export const DRAFT_STORE_NAME = "drafts";
export const DRAFT_DEBOUNCE_MS = 500;
export const DRAFT_LEASE_TTL_MS = 20_000;
export const DRAFT_HEARTBEAT_MS = 5_000;
/** Stable account scope when no site username is available; UI must label it. */
export const ANONYMOUS_ACCOUNT_SCOPE = "anon";

const DRAFT_CHANNEL_NAME = "monacoanywhere:drafts";
const DRAFT_KEY_PATTERN = /^[0-9a-f]{64}$/;
const MAX_KEY_PART_LENGTH = 1_024;
const MAX_WRITER_ID_LENGTH = 128;

interface DraftWireMessage {
  type: "changed" | "deleted";
  key: string;
  writerId: string;
  revision: number;
  updatedAt: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertDraftKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !DRAFT_KEY_PATTERN.test(key)) {
    throw new TypeError("Invalid draft key: expected 64 lowercase hex characters.");
  }
}

function assertDraftKeyParts(parts: DraftKeyParts): void {
  if (!isPlainRecord(parts)) {
    throw new TypeError("Draft key parts must be an object.");
  }
  for (const name of [
    "originKey",
    "accountScope",
    "problemKey",
    "editorSlot"
  ] as const) {
    const value = parts[name];
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > MAX_KEY_PART_LENGTH ||
      value.includes("|") ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new TypeError(
        `Invalid draft key part ${name}: expected a non-empty string without "|" or control characters.`
      );
    }
  }
}

/**
 * Deterministic draft id from the four isolating components. Async because the
 * contract requires SHA-256 through crypto.subtle (available in extension
 * pages, workers, and Node 22).
 */
export async function draftKey(parts: DraftKeyParts): Promise<string> {
  assertDraftKeyParts(parts);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("SHA-256 is unavailable; cannot derive a draft key.");
  }
  const input = `${parts.originKey}|${parts.accountScope}|${parts.problemKey}|${parts.editorSlot}`;
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function normalizeDraftRecord(
  value: unknown,
  expectedKey: string
): DraftRecord | null {
  if (!isPlainRecord(value) || value.k !== expectedKey) {
    return null;
  }
  const code = value.code;
  if (typeof code !== "string") {
    return null;
  }
  const updatedAt = value.updatedAt;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) {
    return null;
  }
  const rawLanguageOptionId = value.languageOptionId;
  const languageOptionId =
    typeof rawLanguageOptionId === "string" && rawLanguageOptionId.length > 0
      ? rawLanguageOptionId
      : null;
  const rawSiteEditorValue = value.siteEditorValue;
  const siteEditorValue =
    typeof rawSiteEditorValue === "string" ? rawSiteEditorValue : null;
  const rawBaseSiteValue = value.baseSiteValue;
  const baseSiteValue =
    typeof rawBaseSiteValue === "string" ? rawBaseSiteValue : null;
  const rawRevision = value.revision;
  const revision =
    typeof rawRevision === "number" &&
    Number.isInteger(rawRevision) &&
    rawRevision >= 1
      ? rawRevision
      : 1;
  const rawWriterId = value.writerId;
  const writerId =
    typeof rawWriterId === "string" &&
    rawWriterId.length <= MAX_WRITER_ID_LENGTH
      ? rawWriterId
      : "";
  const rawHeartbeatAt = value.heartbeatAt;
  const heartbeatAt =
    typeof rawHeartbeatAt === "number" &&
    Number.isFinite(rawHeartbeatAt) &&
    rawHeartbeatAt >= 0
      ? rawHeartbeatAt
      : 0;
  return {
    k: expectedKey,
    code,
    languageOptionId,
    updatedAt,
    siteEditorValue,
    baseSiteValue,
    revision,
    writerId,
    heartbeatAt
  };
}

interface NormalizedSaveInput {
  code: string;
  languageOptionId: string | null;
  siteEditorValue: string | null;
  baseSiteValue: string | null;
}

function normalizeSaveInput(input: DraftSaveInput): NormalizedSaveInput {
  if (!isPlainRecord(input)) {
    throw new TypeError("Draft save input must be an object.");
  }
  if (typeof input.code !== "string") {
    throw new TypeError("Draft save input code must be a string.");
  }
  const optionalString = (
    name: "languageOptionId" | "siteEditorValue" | "baseSiteValue",
    emptyIsNull: boolean
  ): string | null => {
    const value = input[name];
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new TypeError(`Draft save input ${name} must be a string or null.`);
    }
    return emptyIsNull && value.length === 0 ? null : value;
  };
  return {
    code: input.code,
    languageOptionId: optionalString("languageOptionId", true),
    siteEditorValue: optionalString("siteEditorValue", false),
    baseSiteValue: optionalString("baseSiteValue", false)
  };
}

function makeDraftRecord(
  key: string,
  input: NormalizedSaveInput,
  writerId: string,
  revision: number,
  updatedAt: number,
  heartbeatAt: number
): DraftRecord {
  return {
    k: key,
    code: input.code,
    languageOptionId: input.languageOptionId,
    updatedAt,
    siteEditorValue: input.siteEditorValue,
    baseSiteValue: input.baseSiteValue,
    revision,
    writerId,
    heartbeatAt
  };
}

function cloneDraftRecord(record: DraftRecord): DraftRecord {
  return { ...record };
}

function draftFreshnessKey(record: DraftRecord): string {
  return (
    JSON.stringify([
      record.code,
      record.languageOptionId,
      record.siteEditorValue,
      record.baseSiteValue
    ]) ?? ""
  );
}

function compareDraftFreshness(a: DraftRecord, b: DraftRecord): number {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt < b.updatedAt ? -1 : 1;
  }
  // Local unsaved revisions are not comparable across tabs (each is derived
  // from its own base). Fall back to the complete content+metadata so both
  // tabs choose identically, including language-only conflicts.
  const aKey = draftFreshnessKey(a);
  const bKey = draftFreshnessKey(b);
  if (aKey === bKey) {
    return 0;
  }
  return aKey < bKey ? -1 : 1;
}

function draftConflict(
  key: string,
  local: DraftRecord,
  remote: DraftRecord,
  otherWriterActive: boolean
): DraftConflict {
  return {
    key,
    local,
    remote,
    newer: compareDraftFreshness(local, remote) >= 0 ? "local" : "remote",
    reason: otherWriterActive ? "lease-held" : "remote-changed",
    otherWriterActive
  };
}

function isDraftWireMessage(value: unknown): value is DraftWireMessage {
  return (
    isPlainRecord(value) &&
    (value.type === "changed" || value.type === "deleted") &&
    typeof value.key === "string" &&
    DRAFT_KEY_PATTERN.test(value.key) &&
    typeof value.writerId === "string" &&
    value.writerId.length <= MAX_WRITER_ID_LENGTH &&
    typeof value.revision === "number" &&
    Number.isFinite(value.revision) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

function makeWriterId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return `ma-${hex}`;
  }
  throw new Error("No secure random source is available for the draft writer id.");
}

/* ------------------------------------------------------------------ */
/* IndexedDB production store                                          */
/* ------------------------------------------------------------------ */

let databasePromise: Promise<IDBDatabase> | null = null;

function openDraftDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is unavailable; local recovery drafts are disabled.")
    );
  }
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        db.createObjectStore(DRAFT_STORE_NAME, { keyPath: "k" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const store = db
        .transaction(DRAFT_STORE_NAME, "readonly")
        .objectStore(DRAFT_STORE_NAME);
      if (store.keyPath !== "k") {
        db.close();
        databasePromise = null;
        reject(
          new Error(
            `${DRAFT_DB_NAME}/${DRAFT_STORE_NAME} has an unexpected keyPath; drafts are unavailable.`
          )
        );
        return;
      }
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      db.onclose = () => {
        if (databasePromise === pending) {
          databasePromise = null;
        }
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open the draft database."));
    };
    request.onblocked = () => {
      // Another extension page is holding an old connection; IndexedDB will
      // continue once it closes. There is no permanent lock to work around.
    };
  });
  databasePromise = pending;
  void pending.catch(() => {
    if (databasePromise === pending) {
      databasePromise = null;
    }
  });
  return pending;
}

function transactionError(tx: IDBTransaction, fallback: string): Error {
  const error = tx.error;
  if (!error) {
    return new Error(fallback);
  }
  return new Error(error.message || fallback);
}

/**
 * IndexedDB-backed store used in production. Each mutate() runs get + put in
 * one readwrite transaction, so the conflict check and write are atomic across
 * tabs. No extra object store is needed; lease metadata lives in the record.
 */
export function createIndexedDbDraftStore(): DraftStore {
  return {
    async get(key) {
      assertDraftKey(key);
      const db = await openDraftDatabase();
      return new Promise<DraftRecord | null>((resolve, reject) => {
        const tx = db.transaction(DRAFT_STORE_NAME, "readonly");
        const request = tx.objectStore(DRAFT_STORE_NAME).get(key);
        request.onsuccess = () => {
          resolve(normalizeDraftRecord(request.result, key));
        };
        request.onerror = () => {
          reject(request.error ?? new Error("Could not read the draft."));
        };
        tx.onabort = () => {
          reject(transactionError(tx, "Draft read transaction aborted."));
        };
      });
    },

    async mutate(key, decide) {
      assertDraftKey(key);
      const db = await openDraftDatabase();
      return new Promise<DraftMutationResult>((resolve, reject) => {
        const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
        const store = tx.objectStore(DRAFT_STORE_NAME);
        const request = store.get(key);
        const state: {
          after: DraftRecord | null;
          changed: boolean;
          settled: boolean;
          failure: unknown;
        } = { after: null, changed: false, settled: false, failure: null };

        const fail = (error: unknown): void => {
          if (state.settled) {
            return;
          }
          state.settled = true;
          reject(error);
        };

        request.onsuccess = () => {
          try {
            const current = normalizeDraftRecord(request.result, key);
            const decision = decide(current);
            if (decision.delete) {
              state.after = null;
              state.changed = current !== null;
              if (current !== null) {
                store.delete(key);
              }
            } else if (decision.put) {
              const put = normalizeDraftRecord(decision.put, key);
              if (!put) {
                throw new TypeError("Draft store produced an invalid record.");
              }
              state.after = put;
              state.changed = true;
              store.put(put);
            } else {
              state.after = current;
              state.changed = false;
            }
          } catch (error: unknown) {
            state.failure = error;
            try {
              tx.abort();
            } catch {
              // The transaction may already have aborted.
            }
            fail(error);
          }
        };
        request.onerror = () => {
          state.failure = request.error;
          fail(request.error ?? new Error("Could not read the draft."));
        };
        tx.oncomplete = () => {
          if (state.settled) {
            return;
          }
          state.settled = true;
          resolve({ record: state.after, changed: state.changed });
        };
        tx.onerror = () => {
          fail(state.failure ?? transactionError(tx, "Draft write failed."));
        };
        tx.onabort = () => {
          fail(state.failure ?? transactionError(tx, "Draft write aborted."));
        };
      });
    },

    async delete(key) {
      assertDraftKey(key);
      const db = await openDraftDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
        tx.objectStore(DRAFT_STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(transactionError(tx, "Could not delete the draft."));
        tx.onabort = () =>
          reject(transactionError(tx, "Draft delete transaction aborted."));
      });
    },

    async clear() {
      const db = await openDraftDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
        tx.objectStore(DRAFT_STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(transactionError(tx, "Could not clear drafts."));
        tx.onabort = () =>
          reject(transactionError(tx, "Draft clear transaction aborted."));
      });
    }
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic in-memory store (tests / explicit harnesses)          */
/* ------------------------------------------------------------------ */

/**
 * Conforming DraftStore with the same one-transaction-per-mutation semantics
 * as IndexedDB. It exists for deterministic tests; production always uses
 * createIndexedDbDraftStore(). Records are cloned at the boundary.
 */
export function createMemoryDraftStore(
  initial?: Iterable<DraftRecord>
): DraftStore {
  const records = new Map<string, DraftRecord>();
  if (initial) {
    for (const record of initial) {
      if (typeof record?.k === "string" && DRAFT_KEY_PATTERN.test(record.k)) {
        const normalized = normalizeDraftRecord(record, record.k);
        if (normalized) {
          records.set(normalized.k, normalized);
        }
      }
    }
  }
  const chains = new Map<string, Promise<unknown>>();

  function enqueue<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tracked = run.then(
      () => undefined,
      () => undefined
    );
    chains.set(key, tracked);
    void tracked.finally(() => {
      if (chains.get(key) === tracked) {
        chains.delete(key);
      }
    });
    return run;
  }

  return {
    async get(key) {
      assertDraftKey(key);
      return enqueue<DraftRecord | null>(key, () => {
        const record = records.get(key);
        return record ? cloneDraftRecord(record) : null;
      });
    },

    async mutate(key, decide) {
      assertDraftKey(key);
      return enqueue<DraftMutationResult>(key, () => {
        const current = records.get(key) ?? null;
        const decision = decide(current ? cloneDraftRecord(current) : null);
        if (decision.delete) {
          const changed = current !== null;
          records.delete(key);
          return { record: null, changed };
        }
        if (decision.put) {
          const put = normalizeDraftRecord(decision.put, key);
          if (!put) {
            throw new TypeError("Draft store produced an invalid record.");
          }
          records.set(key, put);
          return { record: cloneDraftRecord(put), changed: true };
        }
        return {
          record: current ? cloneDraftRecord(current) : null,
          changed: false
        };
      });
    },

    async delete(key) {
      assertDraftKey(key);
      await enqueue<void>(key, () => {
        records.delete(key);
      });
    },

    async clear() {
      await Promise.all([...chains.values()]);
      records.clear();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Session                                                            */
/* ------------------------------------------------------------------ */

/**
 * Open a draft session for one editor identity. `load()` reads the current
 * record without adopting it; call `adopt()` after an explicit restore or
 * "use other page" choice so the next autosave compares against that content.
 */
export async function openDraftSession(
  parts: DraftKeyParts,
  options: DraftSessionOptions = {}
): Promise<DraftSession> {
  const key = await draftKey(parts);
  const store = options.store ?? createIndexedDbDraftStore();
  const now = options.now ?? (() => Date.now());
  const debounceMs = options.debounceMs ?? DRAFT_DEBOUNCE_MS;
  const leaseTtlMs = options.leaseTtlMs ?? DRAFT_LEASE_TTL_MS;
  const heartbeatMs = options.heartbeatMs ?? DRAFT_HEARTBEAT_MS;
  if (!Number.isInteger(debounceMs) || debounceMs < 0) {
    throw new RangeError("debounceMs must be a non-negative integer.");
  }
  if (!Number.isFinite(leaseTtlMs) || leaseTtlMs <= 0) {
    throw new RangeError("leaseTtlMs must be a positive number.");
  }
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 0) {
    throw new RangeError("heartbeatMs must be a non-negative integer.");
  }
  const writerId = options.writerId ?? makeWriterId();
  if (
    typeof writerId !== "string" ||
    writerId.length === 0 ||
    writerId.length > MAX_WRITER_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(writerId)
  ) {
    throw new TypeError("Invalid draft writer id.");
  }

  let known: DraftRecord | null = await store.get(key);
  let pending: { input: NormalizedSaveInput; changedAt: number } | null = null;
  let pendingResult: Promise<DraftSaveResult> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let released = false;

  let operationChain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(event: DraftSessionEvent) => void>();

  const reportError = (error: unknown): void => {
    if (options.onError) {
      options.onError(error);
    } else {
      console.error("[MonacoAnywhere] Draft persistence failed", error);
    }
  };

  const emit = (event: DraftSessionEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        reportError(error);
      }
    }
  };

  let channel: BroadcastChannel | null = null;
  if (options.broadcast !== false && typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(DRAFT_CHANNEL_NAME);
    } catch {
      // Persistence still works without cross-tab notifications; save-time
      // conflict detection remains the source of truth.
      channel = null;
    }
  }
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (!isDraftWireMessage(event.data) || event.data.key !== key) {
        return;
      }
      if (event.data.writerId === writerId) {
        return;
      }
      emit({
        type: "remote-change",
        revision: event.data.revision,
        updatedAt: event.data.updatedAt,
        writerId: event.data.writerId
      });
    };
  }

  const broadcast = (
    type: DraftWireMessage["type"],
    record: DraftRecord | null,
    at: number
  ): void => {
    if (!channel) {
      return;
    }
    try {
      channel.postMessage({
        type,
        key,
        writerId,
        revision: record?.revision ?? 0,
        updatedAt: record?.updatedAt ?? at
      } satisfies DraftWireMessage);
    } catch {
      // A closed channel only means cross-tab notifications stop; saving works.
    }
  };

  const enqueueOperation = <T>(task: () => Promise<T>): Promise<T> => {
    const run = operationChain.then(task, task);
    operationChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const stopHeartbeat = (): void => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const ensureHeartbeat = (record: DraftRecord): void => {
    if (
      released ||
      heartbeatMs <= 0 ||
      record.writerId !== writerId ||
      heartbeatTimer !== null
    ) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      if (released) {
        stopHeartbeat();
        return;
      }
      void enqueueOperation(async () => {
        const at = now();
        let lost = false;
        const outcome = await store.mutate(key, (current) => {
          if (!current || current.writerId !== writerId) {
            lost = true;
            return {};
          }
          return { put: { ...current, heartbeatAt: at } };
        });
        if (released) {
          return;
        }
        if (lost || outcome.record?.writerId !== writerId) {
          stopHeartbeat();
          emit({ type: "lease-lost" });
        }
      }).catch((error: unknown) => {
        reportError(error);
      });
    }, heartbeatMs);
  };

  /**
   * Follow ownership after adopting or committing a record. An old heartbeat
   * must stop when this tab no longer owns the stored record.
   */
  const syncHeartbeat = (record: DraftRecord | null): void => {
    if (!record || record.writerId !== writerId) {
      stopHeartbeat();
      return;
    }
    ensureHeartbeat(record);
  };

  const performSave = async (
    input: NormalizedSaveInput,
    changedAt: number
  ): Promise<DraftSaveResult> => {
    const at = now();
    const local = makeDraftRecord(
      key,
      input,
      writerId,
      (known?.revision ?? 0) + 1,
      changedAt,
      changedAt
    );
    const state: { conflict: DraftConflict | null } = { conflict: null };
    const outcome = await store.mutate(key, (current) => {
      if (current === null) {
        return {
          put: { ...local, revision: 1, updatedAt: at, heartbeatAt: at }
        };
      }
      const otherWriterActive =
        current.writerId !== writerId &&
        current.heartbeatAt > 0 &&
        current.heartbeatAt > at - leaseTtlMs;
      const remoteChanged =
        known === null ||
        current.updatedAt !== known.updatedAt ||
        current.revision !== known.revision;
      if (current.code === input.code) {
        const metadataUnchanged =
          current.languageOptionId === input.languageOptionId &&
          current.siteEditorValue === input.siteEditorValue &&
          current.baseSiteValue === input.baseSiteValue;
        if (metadataUnchanged) {
          return {};
        }
        if (otherWriterActive || remoteChanged) {
          state.conflict = draftConflict(
            key,
            { ...local, revision: current.revision + 1 },
            current,
            otherWriterActive
          );
          return {};
        }
        // Same code but newer language/site metadata is still a record change:
        // bump the revision so another tab cannot silently clobber it.
        return {
          put: {
            ...current,
            languageOptionId: input.languageOptionId,
            siteEditorValue: input.siteEditorValue,
            baseSiteValue: input.baseSiteValue,
            revision: current.revision + 1,
            updatedAt: at,
            writerId,
            heartbeatAt: at
          }
        };
      }
      if (otherWriterActive || remoteChanged) {
        state.conflict = draftConflict(
          key,
          { ...local, revision: current.revision + 1 },
          current,
          otherWriterActive
        );
        return {};
      }
      return {
        put: {
          ...local,
          revision: current.revision + 1,
          updatedAt: at,
          heartbeatAt: at
        }
      };
    });
    const conflict = state.conflict;
    if (conflict) {
      emit({ type: "conflict", conflict });
      return { status: "conflict", conflict };
    }
    if (outcome.record === null) {
      throw new Error("The draft vanished while saving.");
    }
    known = outcome.record;
    syncHeartbeat(outcome.record);
    if (outcome.changed) {
      broadcast("changed", outcome.record, at);
    }
    emit({
      type: "saved",
      record: outcome.record,
      wrote: outcome.changed
    });
    return {
      status: "saved",
      record: outcome.record,
      wrote: outcome.changed
    };
  };

  const queueSave = (
    input: NormalizedSaveInput,
    changedAt: number
  ): Promise<DraftSaveResult> =>
    enqueueOperation(() => performSave(input, changedAt));

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const flush = (): Promise<DraftSaveResult | null> => {
    clearDebounce();
    if (!pending) {
      const settled: Promise<DraftSaveResult | null> =
        pendingResult ?? Promise.resolve<DraftSaveResult | null>(null);
      const currentChain = operationChain;
      return settled.then(async (result) => {
        await currentChain;
        return result;
      });
    }
    const next = pending;
    pending = null;
    const result = queueSave(next.input, next.changedAt).catch(
      (error: unknown) => {
        // Keep the unsaved text in memory so an explicit flush or the next
        // edit can retry; do not silently discard it after a transient failure.
        if (!released && pending === null) {
          pending = next;
        }
        throw error;
      }
    );
    pendingResult = result;
    const clear = (): void => {
      if (pendingResult === result) {
        pendingResult = null;
      }
    };
    void result.then(clear, clear);
    return result;
  };

  const cancel = (): void => {
    clearDebounce();
    pending = null;
  };

  const performResolve = (
    conflict: DraftConflict,
    choice: DraftConflictChoice
  ): Promise<DraftSaveResult> =>
    enqueueOperation(async () => {
      const at = now();
      const local = conflict.local;
      const state: { conflict: DraftConflict | null } = { conflict: null };
      const outcome = await store.mutate(key, (current) => {
        if (current === null) {
          if (choice === "other-page") {
            throw new Error("The other local draft no longer exists.");
          }
          return {
            put: { ...local, revision: 1, updatedAt: at, heartbeatAt: at }
          };
        }
        const unchanged =
          current.updatedAt === conflict.remote.updatedAt &&
          current.revision === conflict.remote.revision &&
          current.code === conflict.remote.code;
        if (!unchanged) {
          state.conflict = draftConflict(
            key,
            local,
            current,
            current.writerId !== writerId &&
              current.heartbeatAt > 0 &&
              current.heartbeatAt > at - leaseTtlMs
          );
          return {};
        }
        const useLocal =
          choice === "this-page" ||
          (choice === "newer" && compareDraftFreshness(local, current) >= 0);
        if (!useLocal) {
          return {};
        }
        return {
          put: {
            ...local,
            revision: current.revision + 1,
            updatedAt: at,
            heartbeatAt: at
          }
        };
      });
      const nextConflict = state.conflict;
      if (nextConflict) {
        emit({ type: "conflict", conflict: nextConflict });
        return { status: "conflict", conflict: nextConflict };
      }
      if (outcome.record === null) {
        throw new Error("The draft vanished while resolving the conflict.");
      }
      known = outcome.record;
      syncHeartbeat(outcome.record);
      if (outcome.changed) {
        broadcast("changed", outcome.record, at);
      }
      emit({
        type: "saved",
        record: outcome.record,
        wrote: outcome.changed
      });
      return {
        status: "saved",
        record: outcome.record,
        wrote: outcome.changed
      };
    });

  const performDelete = (): Promise<void> =>
    enqueueOperation(async () => {
      const at = now();
      stopHeartbeat();
      const outcome = await store.mutate(key, (current) =>
        current ? { delete: true } : {}
      );
      known = null;
      if (outcome.changed) {
        broadcast("deleted", null, at);
      }
    });

  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    cancel();
    stopHeartbeat();
    if (channel) {
      channel.close();
    }
    listeners.clear();
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    if (known?.writerId === writerId) {
      void store
        .mutate(key, (current) =>
          current && current.writerId === writerId
            ? { put: { ...current, heartbeatAt: 0 } }
            : {}
        )
        .catch(reportError);
    }
  };

  function handlePageHide(event: PageTransitionEvent): void {
    const keepSession = event.persisted === true;
    void flush()
      .catch(reportError)
      .finally(() => {
        if (!keepSession) {
          release();
        }
      });
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      void flush().catch(reportError);
    }
  }

  if (
    options.autoLifecycle !== false &&
    typeof window !== "undefined" &&
    typeof document !== "undefined"
  ) {
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return {
    key,
    writerId,
    load: () => store.get(key),
    adopt(record) {
      if (record !== null) {
        const normalized = normalizeDraftRecord(record, key);
        if (!normalized) {
          throw new TypeError("Cannot adopt an invalid draft record for this key.");
        }
        known = normalized;
      } else {
        known = null;
      }
      if (known) {
        syncHeartbeat(known);
      } else {
        stopHeartbeat();
      }
    },
    scheduleSave(input) {
      if (released) {
        throw new Error("This draft session has been released.");
      }
      const normalized = normalizeSaveInput(input);
      const changedAt = now();
      pending = { input: normalized, changedAt };
      clearDebounce();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void flush().catch((error: unknown) => {
          reportError(error);
        });
      }, debounceMs);
    },
    hasPending: () => pending !== null,
    flush,
    cancel,
    saveNow(input) {
      if (released) {
        return Promise.reject(new Error("This draft session has been released."));
      }
      let normalized: NormalizedSaveInput;
      try {
        normalized = normalizeSaveInput(input);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      cancel();
      return queueSave(normalized, now());
    },
    resolve(conflict, choice) {
      if (released) {
        return Promise.reject(new Error("This draft session has been released."));
      }
      if (!conflict || conflict.key !== key) {
        return Promise.reject(new TypeError("Conflict does not belong to this draft."));
      }
      if (choice !== "this-page" && choice !== "other-page" && choice !== "newer") {
        return Promise.reject(new TypeError("Unknown draft conflict choice."));
      }
      const local = normalizeDraftRecord(conflict.local, key);
      const remote = normalizeDraftRecord(conflict.remote, key);
      if (!local || !remote) {
        return Promise.reject(new TypeError("Conflict records are invalid."));
      }
      cancel();
      return performResolve(
        { ...conflict, local, remote },
        choice
      );
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    deleteDraft() {
      if (released) {
        return Promise.reject(new Error("This draft session has been released."));
      }
      cancel();
      return performDelete();
    },
    release
  };
}

/**
 * Explicit local deletion by key. There is no remote copy and no undo.
 * Prefer session.deleteDraft() when a session exists so heartbeat/channel state
 * is cleaned up as well.
 */
export async function clearDraft(
  key: string,
  store: DraftStore = createIndexedDbDraftStore()
): Promise<void> {
  assertDraftKey(key);
  await store.delete(key);
}

/** Delete every local recovery draft. */
export async function clearAllDrafts(
  store: DraftStore = createIndexedDbDraftStore()
): Promise<void> {
  await store.clear();
}
