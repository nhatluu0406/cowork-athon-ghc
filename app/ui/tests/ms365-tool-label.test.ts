import { test } from "node:test";
import assert from "node:assert/strict";
import { ms365ToolLabel } from "../src/ms365-tool-label.js";

test("nhãn tool MS365 tiêu biểu", () => {
  assert.equal(ms365ToolLabel("sharepoint_search", false), "Đang tìm trên SharePoint");
  assert.equal(ms365ToolLabel("sharepoint_search", true), "Đã tìm trên SharePoint");
  assert.equal(ms365ToolLabel("teams_post_message", false), "Đang đăng tin nhắn Teams");
  assert.equal(ms365ToolLabel("planner_list_tasks", true), "Đã liệt kê công việc Planner");
  assert.equal(ms365ToolLabel("outlook_search_messages", false), "Đang tìm thư Outlook");
});

test("tool lạ dùng fallback", () => {
  assert.equal(ms365ToolLabel("unknown_tool", false), "Đang dùng công cụ: unknown_tool");
  assert.equal(ms365ToolLabel("unknown_tool", true), "Đã dùng công cụ: unknown_tool");
});
