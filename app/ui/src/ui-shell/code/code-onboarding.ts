import { el } from "../dom-utils.js";

const STEPS: readonly { readonly title: string; readonly copy: string }[] = [
  { title: "Phiên chạy cục bộ", copy: "Mọi phiên chạy trên máy bạn qua local service; không có backend đám mây ẩn." },
  { title: "Ranh giới thực thi", copy: "Ghi tệp và lệnh chạy đều qua permission — Từ chối là chặn thật ở service." },
  { title: "Xem lại diff", copy: "Mỗi thay đổi tệp có snapshot trước/sau và diff chỉ đọc trong SOURCE CONTROL." },
  { title: "Provider trung lập", copy: "Model/provider cấu hình trong Cài đặt; surface này không khoá vào một LLM cụ thể." },
];

export function createCodeOnboarding(onStart: () => void): HTMLElement {
  const wrap = el("section", "cc-onboarding");
  wrap.append(el("h2", "cc-onboarding__title", "Claude Code Desktop hoạt động thế nào"));
  const list = el("ol", "cc-onboarding__steps");
  for (const step of STEPS) {
    const item = el("li", "cc-onboarding__step");
    item.append(el("h3", "cc-onboarding__step-title", step.title), el("p", "cc-onboarding__step-copy", step.copy));
    list.append(item);
  }
  const start = el("button", "cc-onboarding__start", "Bắt đầu phiên làm việc") as HTMLButtonElement;
  start.type = "button";
  start.addEventListener("click", onStart);
  const arch = el("div", "cc-onboarding__arch");
  for (const part of ["UI", "Local service", "OpenCode runtime", "LLM endpoint"]) {
    arch.append(el("span", "cc-onboarding__arch-chip", part));
  }
  wrap.append(list, start, arch);
  return wrap;
}
