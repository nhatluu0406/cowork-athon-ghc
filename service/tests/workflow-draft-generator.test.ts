/**
 * Real workflow-draft generator (Task 4.3 live wiring). All tests inject a FAKE HttpDialer — no
 * live network, no live LLM. They prove: the request is a POST to `/chat/completions` with the
 * Bearer key + system(instruction)+user(prompt) messages; the model's JSON content is parsed into a
 * raw candidate (including a ```json fence); a missing provider profile / bad JSON / non-2xx surface
 * an honest WorkflowGenerationError; and the candidate flows through the real builder to a validated
 * TaskDefinition, with a proposed newAgent referenced by NAME resolving to its assigned id.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_OPENAI_COMPAT_ID,
  createSsrfPolicy,
  providerEnvSpec,
  type DnsResolver,
  type HttpDialer,
  type HttpProbeRequest,
  type HttpProbeResponse,
  type ResolvedAddress,
} from "../src/provider/index.js";
import {
  buildInstruction,
  createLlmWorkflowDraftGenerator,
  createWorkflowBuilder,
  extractCompletionContent,
  parseDraftCandidate,
  WorkflowGenerationError,
  type WorkflowGenTarget,
} from "../src/tasks/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";

const PUBLIC_IP = "93.184.216.34";
const one = (address: string, family: 4 | 6 = 4): readonly ResolvedAddress[] => [{ address, family }];
const staticResolver = (address: string): DnsResolver => async () => one(address);

function fakeDialer(
  respond: (req: HttpProbeRequest) => HttpProbeResponse,
): HttpDialer & { calls: HttpProbeRequest[] } {
  const calls: HttpProbeRequest[] = [];
  const dialer = (async (req: HttpProbeRequest): Promise<HttpProbeResponse> => {
    calls.push(req);
    return respond(req);
  }) as HttpDialer & { calls: HttpProbeRequest[] };
  dialer.calls = calls;
  return dialer;
}

const chatResponse =
  (content: string) =>
  (req: HttpProbeRequest): HttpProbeResponse => ({
    status: 200,
    headers: {},
    dialedIp: req.ip,
    bodyText: JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
  });

async function target(): Promise<{ target: WorkflowGenTarget; credentials: ReturnType<typeof createCredentialService> }> {
  const credentials = createCredentialService({ store: createMemoryStore() });
  const credentialRef = await credentials.store({
    providerId: CUSTOM_OPENAI_COMPAT_ID,
    secret: "sk-workflow-DO-NOT-LEAK-xyz789",
    account: "profile:p1",
  });
  return {
    credentials,
    target: {
      baseUrl: "https://api.example.com/v1",
      credentialRef,
      envSpec: providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "CUSTOM_OPENAI_COMPAT_API_KEY"),
      modelId: "test-model",
    },
  };
}

const VALID_TASK = {
  task: {
    name: "Điều tra X",
    goal: "Điều tra cách module X hoạt động và trả về phát hiện có trích dẫn.",
    loop: { mode: "run_once", maxTurns: 8, maxDurationMs: 300_000 },
    branches: [{ agentId: "researcher", focus: "luồng dữ liệu" }],
  },
};

test("buildInstruction lists the known agent ids and forbids id/source", () => {
  const text = buildInstruction(["researcher", "implementer", "reviewer"]);
  assert.match(text, /researcher, implementer, reviewer/);
  assert.match(text, /KHÔNG thêm field 'id' hay 'source'/);
});

test("extractCompletionContent pulls choices[0].message.content; null on malformed", () => {
  assert.equal(
    extractCompletionContent(JSON.stringify({ choices: [{ message: { content: "hi" } }] })),
    "hi",
  );
  assert.equal(extractCompletionContent(JSON.stringify({ choices: [] })), null);
  assert.equal(extractCompletionContent("not json"), null);
  assert.equal(extractCompletionContent(undefined), null);
});

test("parseDraftCandidate strips a ```json fence and requires task", () => {
  const fenced = "```json\n" + JSON.stringify(VALID_TASK) + "\n```";
  assert.deepEqual(parseDraftCandidate(fenced), VALID_TASK);
  assert.deepEqual(parseDraftCandidate(JSON.stringify(VALID_TASK)), VALID_TASK);
  assert.throws(() => parseDraftCandidate("{ not json"), WorkflowGenerationError);
  assert.throws(() => parseDraftCandidate(JSON.stringify({ newAgent: {} })), WorkflowGenerationError);
});

test("generator POSTs chat/completions with Bearer + system/user messages and parses content", async () => {
  const { credentials, target: t } = await target();
  const dialer = fakeDialer(chatResponse(JSON.stringify(VALID_TASK)));
  const ssrf = createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) });
  const generate = createLlmWorkflowDraftGenerator({
    ssrf,
    credentials,
    resolveTarget: async () => t,
    dialer,
  });

  const candidate = await generate("Điều tra module X", { knownAgentIds: ["researcher"] });
  assert.deepEqual(candidate, VALID_TASK);

  const call = dialer.calls[0]!;
  assert.equal(call.method, "POST");
  assert.match(call.url.href, /\/chat\/completions$/);
  assert.match(String(call.headers?.["authorization"]), /^Bearer /);
  const body = JSON.parse(String(call.body));
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /researcher/);
  assert.equal(body.messages[1].content, "Điều tra module X");
});

test("generator surfaces an honest error when no provider profile is configured", async () => {
  const { credentials } = await target();
  const generate = createLlmWorkflowDraftGenerator({
    ssrf: createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) }),
    credentials,
    resolveTarget: async () => null,
    dialer: fakeDialer(chatResponse("{}")),
  });
  await assert.rejects(() => generate("x", { knownAgentIds: [] }), WorkflowGenerationError);
});

test("generator + builder: valid draft validates into a TaskDefinition", async () => {
  const { credentials, target: t } = await target();
  const generate = createLlmWorkflowDraftGenerator({
    ssrf: createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) }),
    credentials,
    resolveTarget: async () => t,
    dialer: fakeDialer(chatResponse(JSON.stringify(VALID_TASK))),
  });
  const builder = createWorkflowBuilder({
    generate,
    knownAgentIds: () => new Set(["researcher", "implementer", "reviewer"]),
    basePolicy: { edit: "ask" },
  });
  const outcome = await builder.draftFromPrompt("Điều tra module X");
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.task.branches?.[0]?.agentId, "researcher");
    assert.equal(outcome.task.goal.length > 0, true);
    assert.equal(outcome.newAgent, undefined);
  }
});

test("generator + builder: a proposed newAgent referenced BY NAME resolves to its assigned id", async () => {
  const draft = {
    task: {
      name: "Audit bảo mật",
      goal: "Rà soát rủi ro bảo mật của thay đổi hiện tại.",
      loop: { mode: "run_once", maxTurns: 8, maxDurationMs: 300_000 },
      branches: [{ agentId: "Security Auditor", focus: "injection" }],
    },
    newAgent: {
      name: "Security Auditor",
      systemPrompt: "Bạn là chuyên gia bảo mật, chỉ đọc và báo cáo rủi ro, không sửa file.",
    },
  };
  const { credentials, target: t } = await target();
  const generate = createLlmWorkflowDraftGenerator({
    ssrf: createSsrfPolicy({ resolver: staticResolver(PUBLIC_IP) }),
    credentials,
    resolveTarget: async () => t,
    dialer: fakeDialer(chatResponse(JSON.stringify(draft))),
  });
  const builder = createWorkflowBuilder({
    generate,
    knownAgentIds: () => new Set(["researcher"]),
    basePolicy: { edit: "ask" },
  });
  const outcome = await builder.draftFromPrompt("Rà soát bảo mật với một agent chuyên trách");
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.newAgent?.id, "security-auditor");
    assert.equal(outcome.task.branches?.[0]?.agentId, "security-auditor");
  }
});
