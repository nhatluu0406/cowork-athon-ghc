/**
 * Nhãn tiếng Việt cho tool MS365 hiển thị trong strip tool-activity của tab MS365.
 * Chỉ nhãn hành động — KHÔNG bao gồm args (tránh lộ query/nội dung lên UI). Tool ngoài bảng
 * dùng fallback theo tên tool. Giữ tách khỏi activity-model.ts để model đó thuần Cowork.
 */
const LABELS: Record<string, { doing: string; done: string }> = {
  sharepoint_search: { doing: "Đang tìm trên SharePoint", done: "Đã tìm trên SharePoint" },
  sharepoint_list_site_files: { doing: "Đang liệt kê tệp SharePoint", done: "Đã liệt kê tệp SharePoint" },
  sharepoint_get_file_summary: { doing: "Đang đọc tệp SharePoint", done: "Đã đọc tệp SharePoint" },
  sharepoint_upload_file: { doing: "Đang tải tệp lên SharePoint", done: "Đã tải tệp lên SharePoint" },
  ms365_list_joined_sites: { doing: "Đang liệt kê site SharePoint", done: "Đã liệt kê site SharePoint" },
  outlook_search_messages: { doing: "Đang tìm thư Outlook", done: "Đã tìm thư Outlook" },
  outlook_get_message: { doing: "Đang đọc thư Outlook", done: "Đã đọc thư Outlook" },
  outlook_summarize_message: { doing: "Đang tóm tắt thư Outlook", done: "Đã tóm tắt thư Outlook" },
  planner_list_plans: { doing: "Đang liệt kê kế hoạch Planner", done: "Đã liệt kê kế hoạch Planner" },
  planner_list_tasks: { doing: "Đang liệt kê công việc Planner", done: "Đã liệt kê công việc Planner" },
  planner_create_task: { doing: "Đang tạo công việc Planner", done: "Đã tạo công việc Planner" },
  planner_create_tasks: { doing: "Đang tạo công việc Planner", done: "Đã tạo công việc Planner" },
  planner_edit_task: { doing: "Đang cập nhật công việc Planner", done: "Đã cập nhật công việc Planner" },
  planner_delete_task: { doing: "Đang xóa công việc Planner", done: "Đã xóa công việc Planner" },
  lists_get_lists: { doing: "Đang liệt kê SharePoint List", done: "Đã liệt kê SharePoint List" },
  lists_get_items: { doing: "Đang đọc mục List", done: "Đã đọc mục List" },
  lists_add_item: { doing: "Đang thêm mục List", done: "Đã thêm mục List" },
  lists_edit_item: { doing: "Đang cập nhật mục List", done: "Đã cập nhật mục List" },
  lists_delete_item: { doing: "Đang xóa mục List", done: "Đã xóa mục List" },
  teams_list_chats: { doing: "Đang liệt kê cuộc trò chuyện Teams", done: "Đã liệt kê cuộc trò chuyện Teams" },
  teams_list_teams: { doing: "Đang liệt kê Teams", done: "Đã liệt kê Teams" },
  teams_list_channels: { doing: "Đang liệt kê kênh Teams", done: "Đã liệt kê kênh Teams" },
  teams_list_members: { doing: "Đang liệt kê thành viên Teams", done: "Đã liệt kê thành viên Teams" },
  teams_get_messages: { doing: "Đang đọc tin nhắn Teams", done: "Đã đọc tin nhắn Teams" },
  teams_post_message: { doing: "Đang đăng tin nhắn Teams", done: "Đã đăng tin nhắn Teams" },
};

export function ms365ToolLabel(toolName: string, done: boolean): string {
  const entry = LABELS[toolName];
  if (entry !== undefined) return done ? entry.done : entry.doing;
  return done ? `Đã dùng công cụ: ${toolName}` : `Đang dùng công cụ: ${toolName}`;
}
