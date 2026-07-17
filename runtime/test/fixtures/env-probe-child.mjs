// Stub child standing in for the real OpenCode binary (which we do NOT have here).
// It prints its received process.env as JSON so the parent test can assert exactly
// which env vars were injected into the spawn. It performs NO auth.json write and no
// network I/O — it only proves env-injection + data-isolation reach a real child.
process.stdout.write(JSON.stringify(process.env));
