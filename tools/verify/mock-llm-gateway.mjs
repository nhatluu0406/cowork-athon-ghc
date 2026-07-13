/**
 * Deterministic OpenAI-compatible mock LLM gateway for packaged file-review verification.
 *
 * Verification tooling only — bind loopback, ephemeral port, scripted tool-call sequences.
 */

import { createServer } from "node:http";

const LOOPBACK = "127.0.0.1";

export function redactAuthHeader(headers) {
  const out = { ...headers };
  if ("authorization" in out) out.authorization = "[redacted]";
  if ("Authorization" in out) out.Authorization = "[redacted]";
  return out;
}

export function assertLoopbackHostname(hostname) {
  if (hostname !== LOOPBACK) {
    throw new Error(`Mock LLM gateway must bind loopback only; got ${hostname}`);
  }
}

/**
 * @typedef {object} MockGatewayScriptStep
 * @property {"tool_call" | "final_text"} kind
 * @property {readonly string[]} [toolNames]
 * @property {Record<string, unknown>} [toolArguments]
 * @property {string} [text]
 */

export function createMockLlmGateway(options = {}) {
  const host = LOOPBACK;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const scripts = [...(options.scripts ?? [])];
  let requestNumber = 0;
  let scriptIndex = 0;
  let server = null;
  let baseUrl = null;
  let closed = false;
  const log = [];

  function nextScript() {
    if (scriptIndex >= scripts.length) {
      throw new Error(`Unexpected mock LLM request #${requestNumber + 1}; script exhausted`);
    }
    return scripts[scriptIndex++];
  }

  function toolCallResponse(step, model) {
    const toolName = step.toolNames?.[0] ?? "write";
    const args = JSON.stringify(step.toolArguments ?? {});
    return {
      id: `chatcmpl-mock-${requestNumber}`,
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call_mock_${requestNumber}`,
                type: "function",
                function: { name: toolName, arguments: args },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
  }

  function finalTextResponse(text, model) {
    return {
      id: `chatcmpl-mock-${requestNumber}`,
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
    };
  }

  function isProbeRequest(body) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasToolResults = messages.some((message) => message?.role === "tool");
    if (hasToolResults) return false;
    if (hasTools) return false;
    if (body.max_tokens === 1) return true;
    const onlyUser = messages.length === 1 && messages[0]?.role === "user";
    return onlyUser && String(messages[0]?.content ?? "").trim().toLowerCase() === "ping";
  }

  function handleChat(body, res) {
    requestNumber += 1;
    const model = typeof body.model === "string" ? body.model : "mock-model";
    const requestedTools = Array.isArray(body.tools)
      ? body.tools.map((tool) => tool?.function?.name).filter(Boolean)
      : [];
    const hasToolResults = Array.isArray(body.messages)
      ? body.messages.some((message) => message?.role === "tool")
      : false;

    let step;
    if (hasToolResults) {
      step = { kind: "final_text", text: "OK" };
    } else if (isProbeRequest(body)) {
      step = { kind: "final_text", text: "pong" };
    } else {
      step = nextScript();
    }

    log.push({
      requestNumber,
      model,
      requestedToolNames: requestedTools,
      selected: step.kind,
      stream: body.stream === true,
    });

    if (body.stream === true) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const id = `chatcmpl-mock-${requestNumber}`;
      if (step.kind === "tool_call") {
        const toolName = step.toolNames?.[0] ?? "write";
        const args = JSON.stringify(step.toolArguments ?? {});
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_mock_${requestNumber}`,
                      type: "function",
                      function: { name: toolName, arguments: args },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          })}\n\n`,
        );
      } else {
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: step.text ?? "OK" },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`,
        );
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const payload =
      step.kind === "tool_call"
        ? toolCallResponse(step, model)
        : finalTextResponse(step.text ?? "OK", model);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  return {
    get baseUrl() {
      return baseUrl;
    },
    get log() {
      return log;
    },
    async start() {
      if (server !== null) return baseUrl;
      server = createServer((req, res) => {
        const timer = setTimeout(() => {
          res.writeHead(504, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "gateway_timeout" }));
        }, timeoutMs);
        const finish = (status, body) => {
          clearTimeout(timer);
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.socket.remoteAddress && req.socket.remoteAddress !== `::ffff:${LOOPBACK}` && req.socket.remoteAddress !== LOOPBACK) {
          finish(403, { error: "non_loopback_client" });
          return;
        }
        const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
        if (req.method === "GET" && url.pathname === "/v1/models") {
          clearTimeout(timer);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model" }] }));
          return;
        }
        if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => {
            clearTimeout(timer);
            let body = {};
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              finish(400, { error: "invalid_json" });
              return;
            }
            try {
              handleChat(body, res);
            } catch (error) {
              finish(500, { error: error instanceof Error ? error.message : "script_error" });
            }
          });
          return;
        }
        finish(404, { error: "not_found" });
      });

      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, host, resolve);
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      baseUrl = `http://${LOOPBACK}:${port}/v1`;
      return baseUrl;
    },
    async stop() {
      if (closed || server === null) return;
      closed = true;
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
      baseUrl = null;
    },
  };
}
