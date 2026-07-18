"Agent harness inner loop build" đề cập đến cơ chế vận hành cốt lõi cho phép một mô hình AI hoạt động như một tác nhân hoàn chỉnh.

Các khía cạnh liên quan đến việc xây dựng vòng lặp bên trong (inner loop) của một agent harness bao gồm:

1.  **Định nghĩa Harness**: Harness là một lớp phần mềm bao quanh mô hình AI, biến nó thành một tác nhân chức năng bằng cách cung cấp các khả năng như điều phối, quản lý ngữ cảnh, bộ nhớ, sử dụng công cụ và bảo mật [^3, ^6]. Nó bao gồm mọi thứ không phải là mô hình AI [^3].
2.  **Vòng lặp Agent (Inner Loop)**: Đây là một quy trình agentic khép kín trong harness [^1, ^7]. Nó bao gồm các bước:
    *   Nhận ngữ cảnh (context) từ các nguồn như Context RAM [^1].
    *   Một tác nhân Q&A của LLM gọi các "Agentic Tools" (ví dụ: CRM, Meetings) [^1].
    *   Nhận phản hồi từ các công cụ này [^1].
    *   Đánh giá các điều kiện dừng ("End Loop Guardrails") [^1].
    *   Tạo phản hồi ("Reply") [^1].
3.  **Các Mẫu Thiết kế Cốt lõi cho Vòng lặp Bên trong**: Các quy trình Agentic tập trung vào bốn mẫu thiết kế chính [^9]:
    *   **Tự phản chiếu (Reflection)**: Tự đánh giá kết quả và sửa lỗi lặp đi lặp lại.
    *   **Sử dụng công cụ (Tool Use)**: Gọi API bên ngoài hoặc thực thi mã.
    *   **Lập kế hoạch (Planning)**: Chia nhỏ các nhiệm vụ lớn và xác định các bước tiếp theo.
    *   **Cộng tác Đa tác nhân (Multi-Agent Collaboration)**: Phân công vai trò cụ thể cho nhiều tác nhân để giải quyết các nhiệm vụ phức tạp.
4.  **Các Lớp Bộ nhớ (Memory Layers)**: Là một phần không thể thiếu của Harness & Loop [^1]:
    *   **Bộ nhớ thủ tục (Procedural Memory)**: Lưu trữ các quy trình hành vi và hướng dẫn (ví dụ: `Skill.md`).
    *   **Bộ nhớ ngữ nghĩa (Semantic Memory)**: Lưu trữ các sự thật bền vững và thông tin người dùng (ví dụ: Vector store).
    *   **Bộ nhớ theo giai đoạn (Episodic Memory)**: Lưu trữ lịch sử hội thoại theo thời gian (ví dụ: SQL + Vector).
    *   **Củng cố bộ nhớ (Memory Consolidation)**: Một tác nhân tóm tắt (Summarizer Agent) định kỳ chắt lọc thông tin cốt lõi từ Episodic Memory sang Semantic Memory [^1].
    *   Các công cụ cụ thể như skill "Context Agent" quản lý ngữ cảnh phiên, tạo tóm tắt và cập nhật các tệp ngữ cảnh hoạt động (`ACTIVE_CONTEXT.md`, `MEMORY.md`) để đảm bảo tính liên tục giữa các phiên [^10, ^11].
5.  **Quản lý Ngữ cảnh**: Vòng lặp bên trong phụ thuộc rất nhiều vào việc quản lý ngữ cảnh hiệu quả. Điều này bao gồm:
    *   Chèn ngữ cảnh từ nhiều nguồn khác nhau (tệp, thư mục, URL, chẩn đoán) [^12].
    *   Sử dụng "Context Glue Files" như `scriptReferences.md` và `readme_this_current_task.md` để cung cấp thông tin neo và quản lý ngữ cảnh qua các phiên, ngăn chặn hiện tượng "trôi ngữ cảnh" (context drift) [^8].
6.  **Tính di động và Linh hoạt**: "Loop engine" trong harness có thể được thiết kế để có tính di động, hỗ trợ các điểm cuối API LLM khác nhau (ví dụ: `native` cho gọi hàm hoặc `react` cho các hành động dựa trên JSON) [^2].
7.  **Phản hồi Chất lượng (LLM Ops)**: Mặc dù vòng lặp bên trong là thời gian chạy, thành phần "LLM Ops" cung cấp phản hồi chất lượng, theo dõi các lần chạy, đánh giá hiệu suất và quản lý các bản phát hành hoặc chẩn đoán dựa trên thành công hoặc thất bại của đánh giá [^1]. Điều này đảm bảo hiệu quả của vòng lặp bên trong.

#### Sources
[^1]: [[concept-make-harness]]
[^2]: [[idea-openwork-harness-port]]
[^3]: [[concept-outer-harness-ai-agent]]
[^6]: [[Enterprise Software Leaders Build AI Agents With NVIDIA]]
[^7]: [[concept-harness-diagram]]
[^8]: [[strategy-context-glue-files]]
[^9]: [[concept-agentic-workflow]]
[^10]: [[SKILL]] (raw/skills-sync/skills/context-agent/SKILL.md)
[^11]: [[context-format]]
[^12]: [[SKILL]] (raw/skills-sync/skills/autonomous-agent-patterns/SKILL.md)