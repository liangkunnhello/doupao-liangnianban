const CRASH_WINDOW_MS = 60_000

export type RendererRecoveryDecision = {
  reload: true
  safeMode: boolean
}

export function decideRendererRecovery(
  crashTimestamps: number[],
  now: number,
): RendererRecoveryDecision {
  const recentCrashCount = crashTimestamps.filter(
    (timestamp) => now - timestamp <= CRASH_WINDOW_MS,
  ).length

  return {
    reload: true,
    safeMode: recentCrashCount >= 2,
  }
}
