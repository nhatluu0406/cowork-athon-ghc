/**
 * The self-contained remote PWA shell served by the gateway (MVP slice — no build step, no
 * external asset, no CDN). It holds NO data at rest beyond the device token in
 * sessionStorage (cleared when the tab closes; keyring-backed refresh is a follow-up), and
 * renders three states: pair, conversation list, live stream view.
 *
 * SSE is consumed via fetch-streaming (EventSource cannot send the Authorization header).
 */

export const REMOTE_PWA_MANIFEST = JSON.stringify({
  name: "Cowork Remote",
  short_name: "Cowork",
  start_url: "/",
  display: "standalone",
  background_color: "#101418",
  theme_color: "#101418",
  icons: [],
});

export const REMOTE_PWA_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#101418">
<link rel="manifest" href="/manifest.webmanifest">
<title>Cowork Remote</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #101418; color: #e6e9ec; min-height: 100vh; }
  header { padding: 14px 16px; border-bottom: 1px solid #232a31; display: flex;
           align-items: center; justify-content: space-between; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .sub { font-size: 12px; color: #8a949e; }
  main { padding: 16px; max-width: 720px; margin: 0 auto; }
  .card { background: #171d23; border: 1px solid #232a31; border-radius: 12px;
          padding: 16px; margin-bottom: 12px; }
  input, button { font: inherit; }
  input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #2c343c;
          background: #0d1114; color: #e6e9ec; margin-bottom: 10px; }
  button { padding: 12px 16px; border-radius: 8px; border: 0; background: #2f6feb;
           color: #fff; font-weight: 600; width: 100%; }
  button.secondary { background: #232a31; }
  button:disabled { opacity: .5; }
  .error { color: #ff7b72; font-size: 13px; margin: 8px 0 0; min-height: 1em; }
  .conv { display: block; width: 100%; text-align: left; background: #171d23;
          border: 1px solid #232a31; border-radius: 12px; padding: 14px; margin-bottom: 10px;
          color: #e6e9ec; }
  .conv .title { font-weight: 600; margin-bottom: 4px; }
  .conv .meta { font-size: 12px; color: #8a949e; }
  .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px;
           background: #232a31; color: #9fb0c0; margin-left: 6px; }
  .badge.running { background: #1e3a24; color: #7ee787; }
  .badge.errored { background: #3a1e1e; color: #ff7b72; }
  #stream { white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.5; }
  .ev { color: #8a949e; font-size: 12px; margin: 6px 0; }
  .hidden { display: none; }
  .row { display: flex; gap: 8px; }
  .row button { width: auto; flex: 1; }
  .perm { background: #221a10; border: 1px solid #4d3a1a; border-radius: 12px;
          padding: 14px; margin-bottom: 10px; }
  .perm .desc { font-weight: 600; margin-bottom: 4px; }
  .perm .path { font-size: 12px; color: #c9a86a; word-break: break-all; margin-bottom: 10px; }
  .perm .row button.allow { background: #238636; }
  .perm .row button.deny { background: #6e2c2c; }
  .perm .note { font-size: 12px; color: #8a949e; margin-top: 6px; min-height: 1em; }
  .tabs { display: flex; gap: 6px; margin-bottom: 14px; border-bottom: 1px solid #232a31; }
  .tab-btn { flex: 1; width: auto; background: transparent; color: #8a949e; font-weight: 600;
             border-radius: 8px 8px 0 0; padding: 10px 8px; border-bottom: 2px solid transparent; }
  .tab-btn[aria-selected="true"] { color: #e6e9ec; border-bottom: 2px solid #2f6feb; }
  .dispatch-section { margin-bottom: 16px; }
  .dispatch-section__label { font-size: 12px; font-weight: 600; color: #8a949e;
                              text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
  .task-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .task-name { font-weight: 600; }
  .task-meta { font-size: 12px; color: #8a949e; margin-top: 4px; }
  .task-note { margin-top: 6px; }
  .run-btn { width: auto; padding: 8px 14px; font-size: 13px; }
  .run-card { margin-bottom: 8px; }
  .run-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
              flex-wrap: wrap; }
  .run-title { font-weight: 600; }
  .run-meta { font-size: 12px; color: #8a949e; margin: 4px 0 8px; }
  .branch-row { display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding: 6px 0; border-top: 1px solid #232a31; font-size: 13px; }
  .branch-row .summary { color: #8a949e; font-size: 12px; flex-basis: 100%; }
  .cancel-btn { width: auto; padding: 6px 12px; font-size: 12px; margin-top: 8px;
                background: #6e2c2c; }
</style>
</head>
<body>
<header>
  <h1>Cowork Remote</h1>
  <span class="sub" id="who"></span>
</header>
<main>
  <section id="permissions"></section>
  <section id="view-pair" class="card hidden">
    <p>Nhập mã pairing hiển thị trên máy tính (mã dùng một lần, hết hạn sau 2 phút).</p>
    <input id="pair-code" placeholder="Mã pairing (8 ký tự)" autocomplete="one-time-code"
           autocapitalize="characters" maxlength="8">
    <input id="pair-name" placeholder="Tên thiết bị (vd: Điện thoại của Anh)" maxlength="40">
    <button id="pair-btn">Kết nối</button>
    <p class="error" id="pair-error"></p>
  </section>

  <section id="view-list" class="hidden">
    <div class="row" style="margin-bottom:12px">
      <button class="secondary" id="logout-btn">Ngắt kết nối</button>
    </div>
    <div class="tabs" role="tablist" aria-label="Khu vực">
      <button class="tab-btn" id="tab-conversations" role="tab" aria-selected="true"
              aria-controls="panel-conversations">Hội thoại</button>
      <button class="tab-btn" id="tab-dispatch" role="tab" aria-selected="false"
              aria-controls="panel-dispatch">Dispatch</button>
    </div>
    <div id="panel-conversations" role="tabpanel" aria-labelledby="tab-conversations">
      <div class="row" style="margin-bottom:12px">
        <button class="secondary" id="refresh-btn">Làm mới</button>
      </div>
      <div id="conversations"></div>
    </div>
    <div id="panel-dispatch" role="tabpanel" aria-labelledby="tab-dispatch" class="hidden">
      <div class="row" style="margin-bottom:12px">
        <button class="secondary" id="dispatch-refresh-btn">Làm mới</button>
      </div>
      <div class="dispatch-section">
        <div class="dispatch-section__label">Task có sẵn</div>
        <div id="dispatch-tasks" aria-live="polite"></div>
      </div>
      <div class="dispatch-section">
        <div class="dispatch-section__label">Lượt chạy</div>
        <div id="dispatch-runs" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <section id="view-detail" class="hidden">
    <button class="secondary" id="back-btn" style="margin-bottom:12px">&#8592; Danh sách</button>
    <div class="card">
      <div class="title" id="detail-title" style="font-weight:600;margin-bottom:8px"></div>
      <div id="stream"></div>
      <p class="error" id="detail-error"></p>
    </div>
    <div class="card" id="composer-card">
      <input id="composer-input" placeholder="Gửi prompt tới phiên này..." maxlength="4000">
      <button id="composer-send">Gửi</button>
      <p class="error" id="composer-note"></p>
    </div>
  </section>
</main>
<script>
(function () {
  "use strict";
  var token = sessionStorage.getItem("cowork-remote-token") || "";
  var streamAbort = null;
  var currentSessionId = null;

  function el(id) { return document.getElementById(id); }
  function show(id) {
    ["view-pair", "view-list", "view-detail"].forEach(function (v) {
      el(v).classList.toggle("hidden", v !== id);
    });
  }
  function authHeaders() { return { authorization: "Bearer " + token }; }

  function api(path) {
    return fetch(path, { headers: authHeaders() }).then(function (res) {
      if (res.status === 401 || res.status === 403) { logout(); throw new Error("unauthorized"); }
      return res.json();
    });
  }

  function logout() {
    token = "";
    sessionStorage.removeItem("cowork-remote-token");
    el("who").textContent = "";
    if (permTimer) { clearInterval(permTimer); permTimer = null; }
    el("permissions").innerHTML = "";
    stopDispatchPolling();
    el("dispatch-tasks").innerHTML = "";
    el("dispatch-runs").innerHTML = "";
    showTab("conversations");
    show("view-pair");
  }

  function pair() {
    var code = el("pair-code").value.trim().toUpperCase();
    var name = el("pair-name").value.trim();
    el("pair-error").textContent = "";
    el("pair-btn").disabled = true;
    fetch("/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code, deviceName: name || undefined }),
    })
      .then(function (res) { return res.json().then(function (j) { return { s: res.status, j: j }; }); })
      .then(function (r) {
        if (r.s !== 200 || !r.j.ok) {
          var reason = (r.j.error && r.j.error.message) || "pairing_failed";
          var vi = {
            no_active_code: "Chưa có mã đang hoạt động. Bấm tạo mã trên máy tính.",
            expired: "Mã đã hết hạn. Tạo mã mới trên máy tính.",
            mismatch: "Mã không đúng.",
            locked: "Nhập sai quá nhiều lần. Tạo mã mới trên máy tính.",
            device_limit: "Đã đạt giới hạn thiết bị.",
          };
          el("pair-error").textContent = vi[reason] || ("Kết nối thất bại: " + reason);
          return;
        }
        token = r.j.data.token;
        sessionStorage.setItem("cowork-remote-token", token);
        enter();
      })
      .catch(function () { el("pair-error").textContent = "Không gọi được gateway."; })
      .finally(function () { el("pair-btn").disabled = false; });
  }

  function statusVi(s) {
    var map = { running: "đang chạy", completed: "hoàn tất", errored: "lỗi",
                cancelled: "đã hủy", ready: "sẵn sàng", draft: "nháp", interrupted: "gián đoạn" };
    return map[s] || s;
  }

  function loadConversations() {
    api("/api/conversations").then(function (j) {
      var wrap = el("conversations");
      wrap.innerHTML = "";
      var items = (j.data && j.data.conversations) || [];
      if (items.length === 0) {
        wrap.innerHTML = '<div class="card">Chưa có hội thoại nào.</div>';
        return;
      }
      items.forEach(function (c) {
        var b = document.createElement("button");
        b.className = "conv";
        var badge = '<span class="badge ' + c.status + '">' + statusVi(c.status) + "</span>";
        b.innerHTML = '<div class="title"></div><div class="meta"></div>';
        b.querySelector(".title").textContent = c.title || "(chưa đặt tên)";
        b.querySelector(".title").insertAdjacentHTML("beforeend", badge);
        b.querySelector(".meta").textContent = c.workspacePath + " · " + c.messageCount + " tin nhắn";
        b.addEventListener("click", function () { openDetail(c); });
        wrap.appendChild(b);
      });
    }).catch(function () {});
  }

  // --- Dispatch (Task 5.3 phone slice): task catalog + 1-touch run + run list/detail. -----
  // A THIN client of the allowlisted /api/dispatch/* proxy routes: renders exactly what the
  // service reports and fabricates nothing. Polls every 3s ONLY while a run is "running" AND
  // the Dispatch tab is the visible one; an error stops polling and shows an honest message.
  var activeTab = "conversations";
  var dispatchTimer = null;

  var LOOP_MODE_VI = { run_once: "chạy một lần", retry_until_verified: "lặp tới khi xác minh", scheduled: "theo lịch" };
  var RUN_STATUS_VI = { running: "đang chạy", completed: "hoàn thành", partial: "một phần",
                         errored: "lỗi", cancelled: "đã hủy", exhausted: "hết giới hạn" };
  var BRANCH_STATUS_VI = { pending: "chờ", running: "đang chạy", completed: "hoàn thành",
                            errored: "lỗi", cancelled: "đã hủy" };

  function stopDispatchPolling() {
    if (dispatchTimer) { clearTimeout(dispatchTimer); dispatchTimer = null; }
  }

  function showTab(tab) {
    activeTab = tab;
    el("tab-conversations").setAttribute("aria-selected", String(tab === "conversations"));
    el("tab-dispatch").setAttribute("aria-selected", String(tab === "dispatch"));
    el("panel-conversations").classList.toggle("hidden", tab !== "conversations");
    el("panel-dispatch").classList.toggle("hidden", tab !== "dispatch");
    if (tab === "dispatch") loadDispatch();
    else stopDispatchPolling();
  }

  function describeAgents(t) {
    if (t.branches && t.branches.length) {
      return "fan-out " + t.branches.length + " nhánh: " +
        t.branches.map(function (b) { return b.agentId; }).join(", ");
    }
    return t.agentId ? "agent: " + t.agentId : "";
  }

  function renderDispatchTasks(tasks) {
    var wrap = el("dispatch-tasks");
    wrap.innerHTML = "";
    if (tasks.length === 0) {
      wrap.innerHTML = '<div class="card">Chưa có task nào.</div>';
      return;
    }
    tasks.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "card";
      var head = document.createElement("div");
      head.className = "task-head";
      var name = document.createElement("span");
      name.className = "task-name";
      name.textContent = t.name;
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t.source === "built_in" ? "built-in" : "user";
      head.appendChild(name);
      head.appendChild(badge);
      var meta = document.createElement("div");
      meta.className = "task-meta";
      var agents = describeAgents(t);
      meta.textContent = t.id + " · " + (LOOP_MODE_VI[t.loop.mode] || t.loop.mode) +
        (agents ? " · " + agents : "");
      var note = document.createElement("p");
      note.className = "error task-note";
      var runBtn = document.createElement("button");
      runBtn.className = "run-btn";
      runBtn.textContent = "Chạy";
      runBtn.setAttribute("aria-label", "Chạy task " + t.name);
      runBtn.addEventListener("click", function () {
        runBtn.disabled = true;
        note.textContent = "";
        fetch("/api/dispatch/tasks/" + encodeURIComponent(t.id) + "/run", {
          method: "POST",
          headers: authHeaders(),
        })
          .then(function (res) { return res.json().then(function (j) { return { s: res.status, j: j }; }); })
          .then(function (r) {
            if (r.s === 201 && r.j.ok) { loadDispatch(); return; }
            var msg = (r.j.error && r.j.error.message) || "";
            note.textContent = "Chạy thất bại" + (msg ? ": " + msg : "") + ".";
            runBtn.disabled = false;
          })
          .catch(function () {
            note.textContent = "Không gọi được gateway.";
            runBtn.disabled = false;
          });
      });
      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(runBtn);
      card.appendChild(note);
      wrap.appendChild(card);
    });
  }

  function renderDispatchRuns(runs) {
    var wrap = el("dispatch-runs");
    wrap.innerHTML = "";
    if (runs.length === 0) {
      wrap.innerHTML = '<div class="card">Chưa có lượt chạy nào.</div>';
      return;
    }
    runs.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "card run-card";
      var head = document.createElement("div");
      head.className = "run-head";
      var title = document.createElement("span");
      title.className = "run-title";
      title.textContent = r.taskName;
      var badge = document.createElement("span");
      badge.className = "badge " + r.status;
      badge.textContent = RUN_STATUS_VI[r.status] || r.status;
      head.appendChild(title);
      head.appendChild(badge);
      if (r.verified) {
        var verifiedBadge = document.createElement("span");
        verifiedBadge.className = "badge running";
        verifiedBadge.textContent = "đã xác minh";
        head.appendChild(verifiedBadge);
      }
      var meta = document.createElement("div");
      meta.className = "run-meta";
      meta.textContent = r.runId + " · " + (LOOP_MODE_VI[r.loopMode] || r.loopMode) +
        " · lượt " + r.attempts + (r.reason ? " · " + r.reason : "");
      card.appendChild(head);
      card.appendChild(meta);
      (r.branches || []).forEach(function (b) {
        var row = document.createElement("div");
        row.className = "branch-row";
        var agent = document.createElement("span");
        agent.textContent = b.agentName;
        var status = document.createElement("span");
        status.textContent = BRANCH_STATUS_VI[b.status] || b.status;
        row.appendChild(agent);
        row.appendChild(status);
        if (b.summary) {
          var summary = document.createElement("span");
          summary.className = "summary";
          summary.textContent = b.summary;
          row.appendChild(summary);
        }
        card.appendChild(row);
      });
      if (r.status === "running") {
        var cancelBtn = document.createElement("button");
        cancelBtn.className = "cancel-btn";
        cancelBtn.textContent = "Hủy";
        cancelBtn.setAttribute("aria-label", "Hủy lượt chạy " + r.taskName);
        cancelBtn.addEventListener("click", function () {
          cancelBtn.disabled = true;
          fetch("/api/dispatch/runs/" + encodeURIComponent(r.runId) + "/cancel", {
            method: "POST",
            headers: authHeaders(),
          }).then(loadDispatch, loadDispatch);
        });
        card.appendChild(cancelBtn);
      }
      wrap.appendChild(card);
    });
  }

  /** Never fakes a "completed" state: renders exactly what the service reports, or an honest
   * error and stops polling. Re-polls only while a run is live and the tab stays active. */
  function loadDispatch() {
    if (!token) return;
    stopDispatchPolling();
    Promise.all([api("/api/dispatch/tasks"), api("/api/dispatch/runs")])
      .then(function (results) {
        var tasks = (results[0].data && results[0].data.tasks) || [];
        var runs = (results[1].data && results[1].data.runs) || [];
        renderDispatchTasks(tasks);
        renderDispatchRuns(runs);
        var anyRunning = runs.some(function (r) { return r.status === "running"; });
        if (anyRunning && activeTab === "dispatch") {
          dispatchTimer = setTimeout(loadDispatch, 3000);
        }
      })
      .catch(function () {
        el("dispatch-tasks").innerHTML = '<div class="card">Không đọc được dispatch từ service.</div>';
        el("dispatch-runs").innerHTML = "";
      });
  }

  function evLine(ev) {
    if (ev.kind === "token") return null;
    if (ev.kind === "plan") return "Kế hoạch: " + ev.todos.map(function (t) { return t.title; }).join(" / ");
    if (ev.kind === "step") return "Bước [" + ev.status + "] " + ev.label;
    if (ev.kind === "tool_call") return "Tool [" + ev.status + "] " + ev.toolName + (ev.summary ? " — " + ev.summary : "");
    if (ev.kind === "file_mutation") return "File " + ev.operation + ": " + ev.path;
    if (ev.kind === "progress") return "Tiến độ: " + ev.label;
    if (ev.kind === "error") return "Lỗi: " + ev.message;
    if (ev.kind === "terminal") return "Kết thúc: " + ev.state + (ev.message ? " — " + ev.message : "");
    return ev.kind;
  }

  function openDetail(conv) {
    show("view-detail");
    el("detail-title").textContent = conv.title || "(chưa đặt tên)";
    el("detail-error").textContent = "";
    el("composer-note").textContent = "";
    currentSessionId = conv.runtimeSessionId || null;
    el("composer-input").disabled = !currentSessionId;
    el("composer-send").disabled = !currentSessionId;
    if (!currentSessionId) {
      el("composer-note").textContent = "Hội thoại chưa có phiên runtime — tạo lượt mới trên desktop.";
    }
    var stream = el("stream");
    stream.textContent = "";

    api("/api/conversations/" + encodeURIComponent(conv.id)).then(function (j) {
      var record = j.data && j.data.conversation;
      if (!record) return;
      (record.messages || []).forEach(function (m) {
        var div = document.createElement("div");
        div.className = "ev";
        div.textContent = (m.role === "user" ? "Bạn: " : "Agent: ") + m.text;
        stream.appendChild(div);
      });
      if (conv.runtimeSessionId && conv.status === "running") {
        followStream(conv.runtimeSessionId);
      } else {
        var done = document.createElement("div");
        done.className = "ev";
        done.textContent = "Hội thoại không chạy — hiển thị transcript đã lưu.";
        stream.appendChild(done);
      }
    }).catch(function () { el("detail-error").textContent = "Không tải được hội thoại."; });
  }

  function followStream(sessionId) {
    if (streamAbort) streamAbort.abort();
    streamAbort = new AbortController();
    var stream = el("stream");
    var tokenDiv = document.createElement("div");
    stream.appendChild(tokenDiv);

    fetch("/api/stream?sessionId=" + encodeURIComponent(sessionId), {
      headers: authHeaders(),
      signal: streamAbort.signal,
    }).then(function (res) {
      if (!res.ok || !res.body) throw new Error("stream " + res.status);
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return;
          buffer += decoder.decode(step.value, { stream: true });
          var frames = buffer.split("\\n\\n");
          buffer = frames.pop() || "";
          frames.forEach(function (frame) {
            frame.split("\\n").forEach(function (line) {
              if (line.indexOf("data:") !== 0) return;
              var payload = line.slice(5).trim();
              if (!payload) return;
              var ev;
              try { ev = JSON.parse(payload); } catch (e) { return; }
              if (ev.kind === "token") {
                tokenDiv.textContent += ev.delta;
              } else {
                var line2 = evLine(ev);
                if (line2) {
                  var div = document.createElement("div");
                  div.className = "ev";
                  div.textContent = line2;
                  stream.insertBefore(div, tokenDiv);
                }
              }
              window.scrollTo(0, document.body.scrollHeight);
            });
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;
      el("detail-error").textContent = "Mất kết nối stream — quay lại danh sách rồi mở lại.";
    });
  }

  var permTimer = null;

  function levelVi(level) {
    var map = { standard: "tiêu chuẩn", elevated: "nâng cao" };
    return map[level] || level;
  }

  function decide(requestId, decision, scope, card, note) {
    var body = { requestId: requestId, decision: decision };
    if (scope) body.scope = scope;
    card.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    fetch("/api/permissions/decision", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify(body),
    })
      .then(function (res) { return res.json().then(function (j) { return { s: res.status, j: j }; }); })
      .then(function (r) {
        var data = r.j && r.j.data;
        if (r.s === 200 && data && data.status === "resolved") {
          note.textContent = decision === "allow" ? "Đã cho phép." : "Đã từ chối.";
          setTimeout(loadPermissions, 600);
          return;
        }
        if (data && data.status === "already_resolved") {
          note.textContent = "Đã được quyết định ở nơi khác (" + data.decision + ").";
          setTimeout(loadPermissions, 600);
          return;
        }
        note.textContent = "Yêu cầu không còn tồn tại — làm mới danh sách.";
        setTimeout(loadPermissions, 600);
      })
      .catch(function () {
        note.textContent = "Không gửi được quyết định — thử lại.";
        card.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      });
  }

  function loadPermissions() {
    if (!token) return;
    api("/api/permissions").then(function (j) {
      var pending = (j.data && j.data.pending) || [];
      var wrap = el("permissions");
      wrap.innerHTML = "";
      pending.forEach(function (p) {
        var card = document.createElement("div");
        card.className = "perm";
        card.innerHTML =
          '<div class="desc"></div><div class="path"></div>' +
          '<div class="row"><button class="allow">Cho phép 1 lần</button>' +
          '<button class="deny">Từ chối</button></div><div class="note"></div>';
        card.querySelector(".desc").textContent =
          "Yêu cầu quyền (" + levelVi(p.approvalLevel) + "): " + p.action.description;
        card.querySelector(".path").textContent = p.action.targetPath || "";
        var note = card.querySelector(".note");
        card.querySelector(".allow").addEventListener("click", function () {
          decide(p.requestId, "allow", "once", card, note);
        });
        card.querySelector(".deny").addEventListener("click", function () {
          decide(p.requestId, "deny", null, card, note);
        });
        wrap.appendChild(card);
      });
    }).catch(function () {});
  }

  function startPermissionPolling() {
    if (permTimer) clearInterval(permTimer);
    loadPermissions();
    permTimer = setInterval(loadPermissions, 3000);
  }

  function enter() {
    api("/api/me").then(function (j) {
      el("who").textContent = (j.data && j.data.device && j.data.device.name) || "";
      show("view-list");
      showTab("conversations");
      loadConversations();
      startPermissionPolling();
    }).catch(function () {});
  }

  function sendPrompt() {
    var text = el("composer-input").value.trim();
    var note = el("composer-note");
    if (!text || !currentSessionId) return;
    el("composer-send").disabled = true;
    note.textContent = "";
    fetch("/api/sessions/" + encodeURIComponent(currentSessionId) + "/message", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ text: text }),
    })
      .then(function (res) { return res.json().then(function (j) { return { s: res.status, j: j }; }); })
      .then(function (r) {
        if (r.s === 202 && r.j.ok) {
          el("composer-input").value = "";
          note.textContent = "Đã gửi — phản hồi sẽ hiện trong stream.";
          if (currentSessionId) followStream(currentSessionId);
          return;
        }
        var code = (r.j.error && r.j.error.code) || "";
        if (r.s === 409) { note.textContent = "Phiên đã kết thúc — tạo lượt mới trên desktop."; return; }
        if (r.s === 503) { note.textContent = "Runtime chưa sẵn sàng."; return; }
        note.textContent = "Gửi thất bại" + (code ? " (" + code + ")" : "") + ".";
      })
      .catch(function () { note.textContent = "Không gọi được gateway."; })
      .finally(function () { el("composer-send").disabled = !currentSessionId; });
  }

  el("composer-send").addEventListener("click", sendPrompt);
  el("pair-btn").addEventListener("click", pair);
  el("refresh-btn").addEventListener("click", loadConversations);
  el("logout-btn").addEventListener("click", logout);
  el("tab-conversations").addEventListener("click", function () { showTab("conversations"); });
  el("tab-dispatch").addEventListener("click", function () { showTab("dispatch"); });
  el("dispatch-refresh-btn").addEventListener("click", loadDispatch);
  el("back-btn").addEventListener("click", function () {
    if (streamAbort) streamAbort.abort();
    show("view-list");
    loadConversations();
  });

  // A QR-scanned pairing URL carries ?code= — prefill it so the user only taps Connect.
  try {
    var params = new URLSearchParams(window.location.search);
    var prefill = params.get("code");
    if (prefill) el("pair-code").value = prefill.toUpperCase();
  } catch (e) { /* no-op */ }

  if (token) enter(); else show("view-pair");
})();
</script>
</body>
</html>
`;
