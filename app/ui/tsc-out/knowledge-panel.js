/**
 * Knowledge panel — renders citations from M365 Knowledge Graph queries (T2.4).
 *
 * Contextual panel following activity-panel.ts pattern. Shows citations when a turn
 * includes a KnowledgeToolInvocation; renders nothing when no knowledge-tool call occurred (US-2).
 * Vietnamese-first copy per R5.
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function outcomeLabel(outcome) {
    switch (outcome) {
        case "answered":
            return "Có câu trả lời";
        case "unavailable":
            return "Không khả dụng";
        case "timeout":
            return "Hết thời gian";
        case "permission_denied":
            return "Bị từ chối quyền";
    }
}
function entityTypeLabel(entityType) {
    switch (entityType) {
        case "Person":
            return "Người";
        case "Project":
            return "Dự án";
        case "Document":
            return "Tài liệu";
        case "Technology":
            return "Công nghệ";
        case "Customer":
            return "Khách hàng";
        case "Department":
            return "Phòng ban";
    }
}
function renderCitation(citation) {
    const row = el("div", "knowledge-citation-item");
    const head = el("div", "knowledge-citation-head");
    const typeLabel = entityTypeLabel(citation.entityType);
    const typeSpan = el("span", "knowledge-citation-type", typeLabel);
    head.append(typeSpan);
    const nameSpan = el("span", "knowledge-citation-name", citation.displayName);
    head.append(nameSpan);
    row.append(head);
    if (citation.sourceRef !== null) {
        const source = el("div", "knowledge-citation-source");
        source.append(el("small", "", `Ref: ${citation.sourceRef}`));
        row.append(source);
    }
    return row;
}
export function createKnowledgePanel(host, config) {
    const root = el("section", "knowledge-panel");
    const header = el("div", "knowledge-panel__header");
    header.append(el("h3", "knowledge-panel__title", "Lập chỉ mục tri thức"));
    const statusContainer = el("div", "knowledge-status");
    header.append(statusContainer);
    const answerContainer = el("div", "knowledge-answer-container");
    const answerElement = el("p", "knowledge-answer");
    answerContainer.append(answerElement);
    const citationSection = el("div", "knowledge-citations-section");
    citationSection.append(el("div", "knowledge-citations-label", "Trích dẫn"));
    const citations = el("div", "knowledge-citations-list");
    citationSection.append(citations);
    const queryElement = el("div", "knowledge-query-section");
    queryElement.append(el("small", "knowledge-query-label", "Câu hỏi:"));
    queryElement.append(el("div", "knowledge-query", ""));
    root.append(header);
    root.append(queryElement);
    root.append(answerContainer);
    root.append(citationSection);
    if (config.invocation === null) {
        // No knowledge-tool call in this turn — hide the panel entirely (US-2)
        root.hidden = true;
    }
    else {
        const inv = config.invocation;
        // Render query
        const queryDiv = root.querySelector(".knowledge-query");
        queryDiv.textContent = inv.query;
        // Render status
        statusContainer.textContent = outcomeLabel(inv.outcome);
        statusContainer.className = `knowledge-status knowledge-status--${inv.outcome}`;
        // Render answer if present
        if (inv.answer !== null) {
            answerElement.textContent = inv.answer;
        }
        else {
            answerContainer.hidden = true;
        }
        // Render citations
        inv.citations.forEach((citation) => {
            citations.append(renderCitation(citation));
        });
        // Hide citation section if no citations
        if (inv.citations.length === 0) {
            citationSection.hidden = true;
        }
    }
    host.append(root);
    return {
        root,
        citations,
        answerContainer,
        statusContainer,
    };
}
//# sourceMappingURL=knowledge-panel.js.map