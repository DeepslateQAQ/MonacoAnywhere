/*
 * Pause a WASM language session after the tab stays hidden, and rebuild it when
 * the tab becomes visible again. Native sessions do not need this (their state
 * lives in the external process), so callers enable it only for WASM.
 */
export interface VisibilityPauseOptions {
  hiddenPauseMs: number;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export interface VisibilityPauseHandle {
  dispose(): void;
  isPaused(): boolean;
}

export function watchVisibilityPause(
  options: VisibilityPauseOptions
): VisibilityPauseHandle {
  let timer: number | null = null;
  let paused = false;
  let busy = false;
  let disposed = false;

  const clearTimer = (): void => {
    clearTimeout(timer ?? undefined);
    timer = null;
  };

  const pause = async (): Promise<void> => {
    if (disposed || busy || paused) return;
    busy = true;
    try {
      await options.onPause();
      paused = true;
    } catch (error) {
      options.onError?.(error);
    } finally {
      busy = false;
    }
  };

  const resume = async (): Promise<void> => {
    if (disposed || busy || !paused) return;
    busy = true;
    try {
      await options.onResume();
      paused = false;
    } catch (error) {
      options.onError?.(error);
    } finally {
      busy = false;
    }
  };

  const onVisibilityChange = (): void => {
    if (disposed) return;
    if (document.visibilityState === "hidden") {
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        if (document.visibilityState === "hidden") void pause();
      }, Math.max(0, options.hiddenPauseMs));
    } else {
      clearTimer();
      if (paused) void resume();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  if (document.visibilityState === "hidden") {
    timer = window.setTimeout(() => {
      timer = null;
      if (document.visibilityState === "hidden") void pause();
    }, Math.max(0, options.hiddenPauseMs));
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
    isPaused: () => paused
  };
}
