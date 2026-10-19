# Context management between phases

## Problem
`server/prompt.ts` (`buildPrompt`) resends the whole workflow state on every hand-off:

| Block | Max size |
| --- | --- |
| Repository context (`runtime.context`) | 256 KB (~60–70k tokens) |
| Plan, build, review, tests | 32 KB each, full JSON |
| Conversation (last 20 events) | 32 KB |
| Task and test commands | 32 KB each |

This repeats for every phase and every correction cycle, and persistent sessions also keep earlier prompts in their history. The plan also appears several times in the timeline as raw JSON.

## Rules
1. **Per-role hand-off.** A role receives only the previous role's artifact: Builder gets the plan and the last review's issues; Reviewer gets the plan, build summary, diff and failing tests; Planner on resume gets the task and the last verdict.
2. **Diff, not snapshot.** Send `git diff --stat` plus a bounded diff of modified files instead of a repository snapshot. Agents explore the rest with their own tools.
3. **Compact artifacts.** Use the structured outputs already defined (`summary`, `changes`, `remaining`, `issues`). Never pass transcripts.
4. **Reference, not copy.** Store test logs in a workflow file; the prompt carries the last ~30 failing lines and the path.
5. **No duplicates.** Store the plan as a structured event rendered by the panel, not as JSON copied into `event.text`.
6. **Measured budget.** Count tokens before sending (target: 4k planner, 8k builder, 12k reviewer), truncate by priority, show a "Handoff N tokens" badge in the panel.
7. **Fresh session per correction cycle.** The builder restarts with `plan + issues` instead of dragging the whole history; optionally compact the session.
8. **Cheaper models for simple roles** (summaries, test runs).

## Implementation order
1. Replace the 256 KB repository context with `diff --stat` + bounded diff (`server/git.ts`, `server/prompt.ts`); add a test measuring prompt size before/after (`tests/prompt.test.ts`).
2. Per-role hand-offs and removal of duplicates in the timeline.
3. Test logs moved to files.
4. Token budget and panel badge.
5. Fresh-session-per-cycle option.

## État de l’implémentation

- Implémenté : artefacts ciblés par rôle, contexte dépôt réduit au diff et aux fichiers modifiés, résumé des tests en échec, option de sessions neuves par correction.
- Le panneau affiche les objectifs de handoff 4k / 8k / 12k et la dernière estimation fournie par le moteur. Ces objectifs concernent le prompt transmis, pas tout l’historique natif.
- `estimateTokens` estime la taille à partir des octets UTF-8 divisés par quatre ; il ne s’agit pas du tokenizer du modèle. Les blocs fixes du prompt peuvent dépasser l’objectif : ce n’est pas une limite stricte de tokens.
- Les sorties complètes des tests restent dans l’état persistant et sont consultables dans les cartes dépliables ; leur export en fichiers référencés reste à faire.
- La maquette HTML sert de référence visuelle. L’application charge `index.client.tsx` et les composants React Native, pas le HTML. En développement, installer le dossier local puis utiliser `paseo plugin reload paseo-agent-teams` pour recompiler les changements.
