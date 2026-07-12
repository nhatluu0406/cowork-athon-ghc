# L4 Reference Verification - OpenCode/OpenWork (pin v1.17.11)

Read-only research against .loop-engineer/source/openwork/. Paths are relative to that
reference root unless noted. OpenCode is a pinned binary (constants.json ->
opencodeVersion v1.17.11, installed via curl opencode.ai/install); its internal source is
NOT vendored, so OpenCode-internal claims are marked [binary - not in reference] and,
where checked, corroborated by opencode.ai docs.

## QUESTION 1 - Credential path

VERDICT: ENV-INJECTION SUPPORTED. OpenCode reads provider API keys from its process
environment (models.dev per-provider env names). Cowork GHC can feed keys to the child via
the spawn environment at launch and never write a cleartext auth.json.

### (a) Does OpenCode read provider keys from environment variables? - YES
- apps/server/src/env-file.ts:3-12 - comment: user-level env vars are persisted so the
  desktop shell can inject them into every spawned child (OpenCode and OpenWork server);
  motivation cites users setting ANTHROPIC_API_KEY / GCLOUD_* / GCP_* and hitting silent
  auth failures. Reference own confirmation OpenCode resolves provider auth from env.
- Env-var names follow models.dev convention (provider env array, env[0]=primary):
  cloud-provider-config.ts:43-66 (resolveCloudProviderCredentials); getCloudProviderEnv :37.
- Injection path (Windows-aware): runtime.mjs:479-497 loadUserEnvFile() reads env.json;
  runtime.mjs:769-805 buildChildEnv({extra}) layers loadUserEnvFile -> process.env -> extra;
  runtime.mjs:1017-1023 spawnManagedChild -> spawn(prog,args,{env}).
- Env store path: env-file.ts:57-68 (win32 -> %APPDATA%\openwork\env.json); runtime.mjs:463-472.
- Full per-provider env-var table (OPENAI/OPENROUTER/GEMINI/GOOGLE) -> [binary - not in
  reference]. Names evidenced: ANTHROPIC_API_KEY, GCLOUD_*, GCP_* (env-file.ts:6-8).

### (b) In-memory / non-persisting channel? - YES via spawn env; NO per-request header
- Inject at spawn via buildChildEnv extra arg without writing env.json (runtime.mjs:769-782):
  source from OS keychain, pass only in child env - no auth.json, no env.json on disk.
- c.auth.set(...) is the file-persisting auth.json channel: store.ts:1316 and :1374
  (providerID + auth {type api, key} -> OpenCode PUT /auth/:id).
- No per-chat-request API-key header. Server-side config merge via PATCH /workspace/:id/config
  (cloud-provider-config.ts:180-184; store.ts:503 patchRuntimeProviders) - merge, not secret.

### (c) Custom OpenAI-compatible provider (base_url + key)
ProviderConfig (cloud-provider-config.ts:109-183, type @opencode-ai/sdk/v2/client): npm
(:155-160); api = top-level base URL (:161-166); options = ai-sdk record, options.baseURL
holds base URL (read store.ts:311-318; written :167-172) and may hold apiKey; env = key
env-var names (:150). base_url = options.baseURL or api; key = env var OR auth.json
(c.auth.set) OR options.apiKey. Env is the no-cleartext-file option.


## QUESTION 2 - Process identity

VERDICT: KNOWN-PORT + PID + START-TIME + exePath (parent owns the child handle directly).
Argv-token unnecessary, child env unreadable, no health-endpoint id exists (/global/health
returns only {healthy, version}).

### (a) Parent controls child argv + env? - YES
- Direct runtime: argv runtime.mjs:1388 = serve --hostname 127.0.0.1 --port PORT --cors *;
  env runtime.mjs:1383-1386 (buildChildEnv + OPENCODE_SERVER_USERNAME/PASSWORD); spawn
  runtime.mjs:1394-1402 (spawn() at :1017-1023). Parent retains child.pid (runtime.mjs:134,:181).
- Orchestrator runtime: runtime.mjs:1311-1345 (--opencode-bin/-host/-port/-workdir +
  OPENWORK_OPENCODE_USERNAME/PASSWORD).

### (b) serve flags - port/host/cors YES; data-dir NO
- Reference uses --hostname, --port, --cors (runtime.mjs:1388; apps/app/scripts/_util.mjs:56);
  serve --help probed but unparsed (runtime.mjs:984).
- opencode.ai/docs/server: serve accepts --port(4096), --hostname(127.0.0.1), --mdns,
  --mdns-domain, --cors. No --data-dir. [docs - not vendored]

### (c) Identifying id/pid endpoint? - NOT FOUND / NOT AVAILABLE
- OpenCode liveness /health used (runtime.mjs:1414; _util.mjs); per docs /global/health ->
  {healthy, version} only - no pid/instance/hostname/cwd. [docs+ref]
- OpenWork /health -> {ok, version, uptimeMs} (openwork-server.ts:1033) - no pid.
- No /app route returning process identity. NOT FOUND. (/project/current, /path expose cwd
  only - not process identity.)

Feasible mechanism: parent already owns spawned child.pid (runtime.mjs:134). For
cross-restart/orphan re-identification use known-bound-port + PID + process start-time +
exePath (OS process APIs the parent controls). Do NOT rely on argv/env token (child env
unreadable via Win32_Process; 3rd-party argv fixed) or a health-endpoint id (none exists).


## QUESTION 3 - Data-dir isolation + orphan handling

### (a) Per-run OpenCode data dir / SQLite? - YES, via ENV (not a serve flag)
- OpenCode honors XDG_DATA_HOME and OPENCODE_CONFIG_DIR; auth.json at
  $XDG_DATA_HOME/opencode/auth.json:
  - cli.ts:3470-3482 (sandbox sets XDG_DATA_HOME, OPENCODE_CONFIG_DIR, seeds auth.json).
  - cli.ts:2666-2703 (dataDir -> opencode-config root/config; sets XDG_DATA_HOME,
    OPENCODE_CONFIG_DIR, OPENCODE_TEST_HOME).
  - cli.ts:3127 (OPENCODE_CONFIG_DIR set to stateLayout.configDir).
  - Desktop dev-mode: runtime.mjs:751-767 + :796-802 (OPENCODE_CONFIG_DIR, XDG_*).
- Session-scoped isolated data dir IS possible per run via XDG_DATA_HOME/OPENCODE_CONFIG_DIR
  (parent controls child env, Q2a). Orchestrator --data-dir (cli.ts:2649, :4604-4605) is the
  router state dir, not an opencode serve flag.

### (b) Orphan-sweep Unix-only? - YES, no Windows branch
- Sole sweep: runtime.mjs:1060-1087 cleanupPackagedSidecars uses spawnSync ps with args
  -Ao pid=,command= at runtime.mjs:1072, regex-parses rows, then process.kill. NO
  tasklist/wmic/Get-Process Windows branch - unconditional Unix ps.
- Nearby win32 branch is engineInstall (runtime.mjs:1630-1638) which only refuses; unrelated.
  Only taskkill in tree is dev-only killing a known Electron pid (electron-dev.mjs:124).
- Cooperative pre-sweep POST /shutdown to recorded orchestrator daemon (runtime.mjs:642-655,
  called :1066) is cross-platform but covers only the orchestrator daemon, not a generic
  orphaned opencode serve.

Windows gap confirmed: no Windows orphaned-child reaper in reference. Cowork GHC must
implement its own (PID + start-time + exePath + known-port validation).

## NOT FOUND (decisive negatives)
1. OpenCode internal provider/auth-resolution source + full per-provider env-var table -
   [binary - not vendored; pin v1.17.11].
2. Any OpenCode endpoint returning pid / server-instance id - absent in reference and docs.
3. opencode serve --data-dir flag - does not exist; data dir env-driven (XDG_DATA_HOME /
   OPENCODE_CONFIG_DIR).
4. Windows orphan-process sweep - none; runtime.mjs:1072 is Unix ps only.

