import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMemoryDraftStore,
  draftKey,
  openDraftSession,
  type DraftKeyParts,
  type DraftSession,
  type DraftSessionEvent,
  type DraftSessionOptions,
  type DraftStore
} from "../extension/src/data/drafts";

const PARTS: DraftKeyParts = {
  originKey: "https://oj.example",
  accountScope: "anon",
  problemKey: "P1001",
  editorSlot: "main"
};

const sessions: DraftSession[] = [];

async function open(
  store: DraftStore,
  clock: { t: number },
  writerId: string,
  overrides: Partial<DraftSessionOptions> = {}
): Promise<DraftSession> {
  const session = await openDraftSession(PARTS, {
    store,
    writerId,
    now: () => clock.t,
    leaseTtlMs: 50,
    heartbeatMs: 0,
    debounceMs: 500,
    broadcast: false,
    autoLifecycle: false,
    ...overrides
  });
  sessions.push(session);
  return session;
}

afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.release();
  }
  vi.useRealTimers();
});

describe("draft keys", () => {
  it("is the deterministic SHA-256 of the four isolating components", async () => {
    const expected = createHash("sha256")
      .update("https://oj.example|alice|P1001|main")
      .digest("hex");
    expect(
      await draftKey({ ...PARTS, accountScope: "alice" })
    ).toBe(expected);
    expect(
      await draftKey({ ...PARTS, accountScope: "alice" })
    ).toBe(expected);
    expect(
      await draftKey({ ...PARTS, accountScope: "bob" })
    ).not.toBe(expected);
    expect(
      await draftKey({ ...PARTS, problemKey: "P1002" })
    ).not.toBe(expected);
  });

  it("rejects invalid key parts instead of colliding", async () => {
    await expect(draftKey({ ...PARTS, originKey: "" })).rejects.toThrow(
      TypeError
    );
    await expect(
      draftKey({ ...PARTS, accountScope: "   " })
    ).rejects.toThrow(TypeError);
    await expect(
      draftKey({ ...PARTS, editorSlot: "a|b" })
    ).rejects.toThrow(TypeError);
    await expect(
      draftKey({ ...PARTS, problemKey: "x".repeat(2_000) })
    ).rejects.toThrow(TypeError);
    await expect(draftKey(null as never)).rejects.toThrow(TypeError);
  });
});

describe("debounced autosave", () => {
  it("updates language metadata with a new record revision", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const session = await open(store, clock, "tab-language");

    const first = await session.saveNow({
      code: "same code",
      languageOptionId: "cpp17"
    });
    expect(first.status).toBe("saved");
    const before = await store.get(session.key);
    expect(before?.revision).toBe(1);

    clock.t = 1_100;
    const updated = await session.saveNow({
      code: "same code",
      languageOptionId: "cpp20"
    });
    expect(updated.status).toBe("saved");
    if (updated.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(updated.wrote).toBe(true);
    expect(updated.record.languageOptionId).toBe("cpp20");
    expect(updated.record.revision).toBe(2);
    expect(updated.record.updatedAt).toBe(1_100);
  });

  it("waits 500 ms, flushes immediately, and cancels without writing", async () => {
    vi.useFakeTimers();
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const session = await open(store, clock, "tab-debounce");

    session.scheduleSave({ code: "v1", languageOptionId: "cpp17" });
    await vi.advanceTimersByTimeAsync(499);
    expect(await store.get(session.key)).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await session.flush();
    expect((await store.get(session.key))?.code).toBe("v1");
    expect((await store.get(session.key))?.languageOptionId).toBe("cpp17");

    session.scheduleSave({ code: "v2" });
    await vi.advanceTimersByTimeAsync(200);
    session.cancel();
    await vi.advanceTimersByTimeAsync(600);
    expect((await store.get(session.key))?.code).toBe("v1");

    session.scheduleSave({ code: "v3" });
    const flushed = await session.flush();
    expect(flushed?.status).toBe("saved");
    const record = await store.get(session.key);
    expect(record?.code).toBe("v3");
    expect(record?.revision).toBe(2);

    await vi.advanceTimersByTimeAsync(600);
    expect((await store.get(session.key))?.revision).toBe(2);
    expect(session.hasPending()).toBe(false);
  });
});

describe("cross-tab conflicts", () => {
  it("does not overwrite a live writer until the user chooses explicitly", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-a");
    const b = await open(store, clock, "tab-b");
    expect(a.key).toBe(b.key);

    const first = await a.saveNow({
      code: "A",
      languageOptionId: "cpp20",
      siteEditorValue: "site-A",
      baseSiteValue: "base-A"
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(first.record.revision).toBe(1);
    expect(first.wrote).toBe(true);

    const blocked = await b.saveNow({ code: "B" });
    expect(blocked.status).toBe("conflict");
    if (blocked.status !== "conflict") {
      throw new Error("unreachable");
    }
    expect(blocked.conflict.local.code).toBe("B");
    expect(blocked.conflict.remote.code).toBe("A");
    expect(blocked.conflict.remote.siteEditorValue).toBe("site-A");
    expect(blocked.conflict.reason).toBe("lease-held");
    expect(blocked.conflict.otherWriterActive).toBe(true);

    // No silent overwrite happened while the user was deciding.
    expect((await store.get(a.key))?.code).toBe("A");

    const adopted = await b.resolve(blocked.conflict, "other-page");
    expect(adopted.status).toBe("saved");
    if (adopted.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(adopted.wrote).toBe(false);
    expect(adopted.record.code).toBe("A");
    b.adopt(adopted.record);

    // The original conflict is still valid because the remote was unchanged.
    const mine = await b.resolve(blocked.conflict, "this-page");
    expect(mine.status).toBe("saved");
    if (mine.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(mine.wrote).toBe(true);
    expect(mine.record.code).toBe("B");
    expect(mine.record.revision).toBe(2);
    expect((await store.get(a.key))?.code).toBe("B");

    const stale = await a.saveNow({ code: "A2" });
    expect(stale.status).toBe("conflict");
  });

  it("refuses a stale conflict preview when a third write landed", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-a");
    const b = await open(store, clock, "tab-b");

    await a.saveNow({ code: "A" });
    const blocked = await b.saveNow({ code: "B" });
    if (blocked.status !== "conflict") {
      throw new Error("expected a conflict");
    }

    // A third writer (or the other tab after resolving) changes the record.
    clock.t = 1_100;
    const c = await open(store, clock, "tab-c");
    c.adopt(await store.get(c.key));
    const written = await c.saveNow({ code: "C" });
    expect(written.status).toBe("saved");

    const staleResolution = await b.resolve(blocked.conflict, "this-page");
    expect(staleResolution.status).toBe("conflict");
    if (staleResolution.status !== "conflict") {
      throw new Error("unreachable");
    }
    expect(staleResolution.conflict.remote.code).toBe("C");
    expect((await store.get(b.key))?.code).toBe("C");
  });

  it("uses timestamps for the keep-newer choice, including deferred saves", async () => {
    vi.useFakeTimers();
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-a");
    await a.saveNow({ code: "A" });
    const b = await open(store, clock, "tab-b");

    clock.t = 1_100;
    a.scheduleSave({ code: "A2" });

    clock.t = 1_200;
    const bWrite = await b.saveNow({ code: "B" });
    expect(bWrite.status).toBe("saved");

    clock.t = 1_250;
    const conflictResult = await a.flush();
    expect(conflictResult?.status).toBe("conflict");
    if (conflictResult?.status !== "conflict") {
      throw new Error("unreachable");
    }
    expect(conflictResult.conflict.local.updatedAt).toBe(1_100);
    expect(conflictResult.conflict.remote.updatedAt).toBe(1_200);
    expect(conflictResult.conflict.newer).toBe("remote");

    const resolved = await a.resolve(conflictResult.conflict, "newer");
    expect(resolved.status).toBe("saved");
    if (resolved.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(resolved.wrote).toBe(false);
    expect(resolved.record.code).toBe("B");
    expect((await store.get(a.key))?.code).toBe("B");
  });

  it("serializes two saves from the same tab without corruption", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const session = await open(store, clock, "tab-serial");

    const [first, second] = await Promise.all([
      session.saveNow({ code: "X" }),
      session.saveNow({ code: "Y" })
    ]);
    expect(first.status).toBe("saved");
    expect(second.status).toBe("saved");
    const record = await store.get(session.key);
    expect(record?.code).toBe("Y");
    expect(record?.revision).toBe(2);
  });
});

describe("lease recovery", () => {
  it("refreshes a live lease with heartbeats, then releases it", async () => {
    vi.useFakeTimers();
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-heartbeat", {
      heartbeatMs: 10,
      leaseTtlMs: 50
    });
    await a.saveNow({ code: "A" });

    clock.t = 1_040;
    await vi.advanceTimersByTimeAsync(10);
    await a.flush();
    const heartbeated = await store.get(a.key);
    expect(heartbeated?.heartbeatAt).toBe(1_040);

    const b = await open(store, clock, "tab-b", { leaseTtlMs: 50 });
    clock.t = 1_060;
    const conflict = await b.saveNow({ code: "B" });
    expect(conflict.status).toBe("conflict");
    if (conflict.status !== "conflict") {
      throw new Error("unreachable");
    }
    expect(conflict.conflict.reason).toBe("lease-held");

    a.release();
    clock.t = 1_070;
    const afterRelease = await b.saveNow({ code: "B" });
    expect(afterRelease.status).toBe("saved");
  });

  it("releases the lease on a clean close", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-close");
    await a.saveNow({ code: "A" });
    a.release();

    const b = await open(store, clock, "tab-after-close");
    const saved = await b.saveNow({ code: "B" });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(saved.wrote).toBe(true);
    expect(saved.record.code).toBe("B");
  });

  it("recovers after a crashed writer and still blocks a live one", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-a");
    await a.saveNow({ code: "A" });

    // Simulate a crashed tab: no release, heartbeat stops at t=1000.
    clock.t = 1_060;
    const b = await open(store, clock, "tab-b");
    const recovered = await b.saveNow({ code: "B" });
    expect(recovered.status).toBe("saved");
    if (recovered.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(recovered.wrote).toBe(true);
    expect(recovered.record.revision).toBe(2);

    // B is live at t=1060 with a 50 ms TTL.
    clock.t = 1_080;
    const c = await open(store, clock, "tab-c");
    const liveConflict = await c.saveNow({ code: "C" });
    expect(liveConflict.status).toBe("conflict");
    if (liveConflict.status !== "conflict") {
      throw new Error("unreachable");
    }
    expect(liveConflict.conflict.reason).toBe("lease-held");

    // After the TTL passes, the same session can claim the record; the lock
    // is bounded, not permanent.
    clock.t = 1_120;
    const afterExpiry = await c.saveNow({ code: "C" });
    expect(afterExpiry.status).toBe("saved");
    if (afterExpiry.status !== "saved") {
      throw new Error("unreachable");
    }
    expect(afterExpiry.record.code).toBe("C");
    expect(afterExpiry.record.revision).toBe(3);
  });

  it("deletes only the local record on an explicit discard", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const session = await open(store, clock, "tab-delete");
    await session.saveNow({ code: "draft" });
    expect(await store.get(session.key)).not.toBeNull();

    await session.deleteDraft();
    expect(await store.get(session.key)).toBeNull();
  });
});

describe("cross-tab notification", () => {
  it("emits remote-change for another writer's committed save", async () => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const a = await open(store, clock, "tab-a", { broadcast: true });
    const b = await open(store, clock, "tab-b", { broadcast: true });

    const received = Promise.withResolvers<DraftSessionEvent>();
    b.subscribe((next) => {
      if (next.type === "remote-change") {
        received.resolve(next);
      }
    });
    await a.saveNow({ code: "A" });
    const event = await received.promise;
    expect(event.type).toBe("remote-change");
    if (event.type !== "remote-change") {
      throw new Error("unreachable");
    }
    expect(event.writerId).toBe("tab-a");
    expect(event.revision).toBe(1);
  });
});

describe("invalid input", () => {
  it("rejects malformed save inputs, conflicts, and keys", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryDraftStore();
    const session = await open(store, clock, "tab-invalid");

    await expect(session.saveNow({ code: 42 as never })).rejects.toThrow(
      TypeError
    );
    await expect(
      session.resolve(
        { key: "0".repeat(64) } as never,
        "this-page"
      )
    ).rejects.toThrow(TypeError);
    await expect(
      session.resolve({ key: session.key } as never, "bogus" as never)
    ).rejects.toThrow(TypeError);
    await expect(store.get("not-a-key")).rejects.toThrow(TypeError);
  });
});
