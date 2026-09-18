import type { ChildProcess } from 'child_process';

// Stored globally so development module reloads cannot reset active locks.
const runtime = globalThis as typeof globalThis & { automationLocks?: Set<string> };
const locks = runtime.automationLocks ??= new Set<string>();

export function acquireLock(key: string): (() => void) | null {
  if (locks.has(key)) return null;
  locks.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks.delete(key);
  };
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type BrowserHandle = { close(): Promise<void>; process(): ChildProcess | null };

// Always inspect the child, even when close() resolves: a disconnected browser
// transport does not necessarily mean its operating-system process has exited.
export async function closeBrowser(browser?: BrowserHandle | null, timeoutMs = 5000) {
  if (!browser) return;
  const child = browser.process();
  try {
    await withTimeout(browser.close(), timeoutMs);
  } catch (error) {
    console.warn('Browser close failed or timed out', error);
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    // Do not release a browser slot until the OS confirms termination.
    await withTimeout(exited, timeoutMs);
  }
}
