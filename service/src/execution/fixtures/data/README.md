# Captured fixtures land here (`data/*.ndjson`)

**Empty by design.** No fabricated frames — real `<scenario>.ndjson` files are recorded from
a live pinned OpenCode run by the opt-in capture tool (`tools/capture-frames/`) **after** the
product-owner token gate.

Required scenarios (see `../manifest.ts`): `simple-chat`, `tool-call`, `error`, `cancel`.

Until a scenario is captured, its harness test skips with a `NEEDS CAPTURE` reason — it never
reports a fake pass.
