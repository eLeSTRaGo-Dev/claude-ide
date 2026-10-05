// Local-noon unix seconds, so day buckets don't depend on the machine's zone.
export const at = (y: number, m: number, d: number, h = 12): number => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000)

// Wed 2026-10-07 is "now" in the tests.
export const NOW = new Date(2026, 9, 7, 15).getTime()

export const LOG =
  `@${at(2026, 10, 7)}\tAda\n\n 2 files changed, 10 insertions(+), 3 deletions(-)\n` +
  `@${at(2026, 10, 7, 9)}\tAda\n\n 1 file changed, 1 insertion(+)\n` +
  `@${at(2026, 10, 5)}\tBob\n\n 3 files changed, 7 deletions(-)\n` +
  `@${at(2026, 9, 30)}\tAda\n` + // merge: no stat
  `@${at(2026, 9, 1)}\tCy\n\n 1 file changed, 4 insertions(+), 4 deletions(-)\n`
