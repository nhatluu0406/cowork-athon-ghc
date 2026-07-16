# Golden dataset (seeded empty — fill during use)

One folder per role; each case = input (task prompt + scope) and expected qualities
(gate criteria from the role's `.claude/agents/*.md` + the unit's acceptance criteria in
`agent-harness-plan.md` §4). First candidates:

- runtime-llm-engineer: the 2026-07-16 SSRF boot-brick regression
  (`service/tests/compose-seed-ssrf-resilience.test.ts`) as a solved reference case.
- security-reviewer: review of `wrapSettingsStoreWithSsrf` asymmetry (save vs boot validation).
- release-verifier: packaged golden path create→Allow / modify→Deny (roadmap NOW).
