// Captured from a real repository (git log/for-each-ref/show output).
export const BRANCHES =
  '*\x1frefs/heads/develop\x1f908022a\x1forigin/develop\x1f\n \x1frefs/heads/fix/delivery-readiness\x1f39476df\x1f\x1f\n \x1frefs/remotes/origin/HEAD\x1f352e0cc\x1f\x1f\n \x1frefs/remotes/origin/develop\x1f908022a\x1f\x1f\n \x1frefs/remotes/origin/main\x1f352e0cc\x1f\x1f\n \x1frefs/remotes/origin/unity-playground/clean-template\x1f078c920\x1f\x1f\n \x1frefs/remotes/origin/unity-playground/runeward\x1f1204093\x1f\x1f\n \x1frefs/remotes/origin/unity-playground/runeward-camera-fix\x1f1d21cb0\x1f\x1f\n \x1frefs/remotes/origin/upm\x1f97fa05c\x1f\x1f\n'

// `git log --topo-order --format=%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ad%x1f%s --date=short`
// (hand-trimmed from a real repository: two tips sharing a parent, two merges).
export const LOG =
  '1d21cb0bf29913a9d638ea80b3740f67793ed324\x1f1d21cb0\x1f01e037b58d990fbc93ef705bb0bf32916525f921\x1forigin/unity-playground/runeward-camera-fix\x1feLeSTRaGo\x1f2026-07-09\x1fUpdate unity mcp\n352e0ccfcf8783cb444ee15822e54c65deb6da05\x1f352e0cc\x1f01e037b58d990fbc93ef705bb0bf32916525f921 908022ab43fb9bc599342842219a42dfd653f899\x1forigin/main, origin/HEAD\x1feLeSTRaGo\x1f2026-07-09\x1fMerge branch \'develop\' into \'main\'\n908022ab43fb9bc599342842219a42dfd653f899\x1f908022a\x1f06615e2e9ee9921f3ec843539189373c6f8963d2\x1fHEAD -> develop, origin/develop\x1feLeSTRaGo\x1f2026-07-09\x1foh-my-project v0.7.1\n06615e2e9ee9921f3ec843539189373c6f8963d2\x1f06615e2\x1f49a46ba624a3f2c53547547aeacb1ef579707ac1\x1f\x1feLeSTRaGo\x1f2026-07-09\x1fchore: remove stale delivery-readiness audit scratch doc\n49a46ba624a3f2c53547547aeacb1ef579707ac1\x1f49a46ba\x1fca9bddd546a48b6d5e7ef743d4c13ec14e2a6730\x1f\x1feLeSTRaGo\x1f2026-07-09\x1frefactor(develop): rewrite develop stream for legibility\nca9bddd546a48b6d5e7ef743d4c13ec14e2a6730\x1fca9bddd\x1f11b6f7c1932b81496e26bfc19df0905489545241\x1f\x1feLeSTRaGo\x1f2026-07-09\x1frefactor(design): rewrite design stream for legibility\n11b6f7c1932b81496e26bfc19df0905489545241\x1f11b6f7c\x1fedaa5586a58b3b4bfc2c200aa8e2e356f3bbe7fd\x1f\x1feLeSTRaGo\x1f2026-07-09\x1fdocs: reconcile skill-flow + vision to shipped skill logic\n01e037b58d990fbc93ef705bb0bf32916525f921\x1f01e037b\x1f5d0b3a1c7e9f40a2b86d1e3c4f5a67890b1c2d3e edaa5586a58b3b4bfc2c200aa8e2e356f3bbe7fd\x1f\x1feLeSTRaGo\x1f2026-07-08\x1fMerge branch \'develop\' into \'main\'\nedaa5586a58b3b4bfc2c200aa8e2e356f3bbe7fd\x1fedaa558\x1f5d0b3a1c7e9f40a2b86d1e3c4f5a67890b1c2d3e\x1f\x1feLeSTRaGo\x1f2026-07-08\x1foh-my-project v0.7.0\n'

export const STAT =
  '908022ab43fb9bc599342842219a42dfd653f899\neLeSTRaGo <elestrago63@gmail.com>\nThu Jul 9 19:28:12 2026 +0400\n\noh-my-project v0.7.1\n\n\n CHANGELOG.md                      | 26 ++++++++++++++++++++++++++\n plugin/.claude-plugin/plugin.json |  2 +-\n plugin/package.json               |  2 +-\n 3 files changed, 28 insertions(+), 2 deletions(-)\n'

export const PATCH =
  'diff --git a/CHANGELOG.md b/CHANGELOG.md\nindex 2ab3741..af8640a 100644\n--- a/CHANGELOG.md\n+++ b/CHANGELOG.md\n@@ -7,6 +7,32 @@ its `version` is bumped on `main`.\n \n ## [Unreleased]\n \n+## [0.7.1] - 2026-07-09\n+\n+### Design & develop streams rewritten for legibility\n+\n+Restructure both work-stream skills to a thin-router + shared-grammar shape: the shared law lives in\n+one place (the router `SKILL.md`) and each activity reference carries only its distinctive loop.\n+Behaviour-preserving apart from one flagged reconciliation.\n+\n+#### Changed\n+- **Design skill rewritten as a thin router + three-shape reference grammar.** `SKILL.md` is now the\n+  single home for the shared law — the acceptance gate, session lifecycle, the no-code rule, fan-out\n+  doctrine, and the feature-map/Status lifecycle. The five references drop the duplicated blocks and\n+  carry only their distinctive working section: single-loop (`competitive-research`, `spec`),\n+  mode-split (`ui-ux`, `feature-owner`), or part-split (`completeness-audit`). Each activity\'s\n+  loop/modes are written as paste-ready checklist-Plan boxes. Every load-bearing invariant is retained.\n+- **`spec` close reconciled.** The `spec` activity now stages durable learnings to the promote-buffer\n+  and stops, instead of spawning the curator per activity — aligning it with the\n+  chain-consolidates-once rule the skill body already states.\n+- **Develop skill rewritten for legibility** on the same grammar — a thin router `SKILL.md` with the\n+  verify gates and session lifecycle stated once, and paste-ready checklist-Plan loops in\n+  `feature`/`fix`/`refactor`. The generic checklist template + action are aligned with the paste-ready\n+  loop convention.\n'

// `git show --name-status -M --diff-merges=first-parent --format=` of the v0.7.1 commit.
export const NAME_STATUS =
  'M\tCHANGELOG.md\nM\tplugin/package.json\nA\tdocs/read me.md\nD\told.txt\nR100\tsrc/a.ts\tsrc/b.ts\n'

// The same commit's patch, one block per listed file.
export const MULTI_PATCH =
  'diff --git a/CHANGELOG.md b/CHANGELOG.md\nindex 2ab3741..af8640a 100644\n--- a/CHANGELOG.md\n+++ b/CHANGELOG.md\n@@ -1 +1,2 @@\n keep\n+changelog line\n' +
  'diff --git a/plugin/package.json b/plugin/package.json\nindex 111..222 100644\n--- a/plugin/package.json\n+++ b/plugin/package.json\n@@ -1 +1 @@\n-\"version\": \"0.7.0\"\n+\"version\": \"0.7.1\"\n' +
  'diff --git a/docs/read me.md b/docs/read me.md\nnew file mode 100644\nindex 0000000..333\n--- /dev/null\n+++ b/docs/read me.md\n@@ -0,0 +1 @@\n+spaced path\n' +
  'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\nindex 444..0000000\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n' +
  'diff --git a/src/a.ts b/src/b.ts\nsimilarity index 100%\nrename from src/a.ts\nrename to src/b.ts\n'

// A merge commit against its first parent (`--diff-merges=first-parent`).
export const MERGE_NAME_STATUS = 'M\tfrom-develop.txt\n'
export const MERGE_PATCH =
  'diff --git a/from-develop.txt b/from-develop.txt\nindex 555..666 100644\n--- a/from-develop.txt\n+++ b/from-develop.txt\n@@ -1 +1 @@\n-first parent\n+merged in\n'
