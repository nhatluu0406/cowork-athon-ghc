import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { lexer } from 'marked';

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const ORDERED_REF = 'md-ordered';

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
}

function inlineRuns(tokens: any[] | undefined, style: InlineStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const t of tokens || []) {
    if (t.type === 'strong') {
      runs.push(...inlineRuns(t.tokens, { ...style, bold: true }));
    } else if (t.type === 'em') {
      runs.push(...inlineRuns(t.tokens, { ...style, italics: true }));
    } else if (t.type === 'codespan') {
      runs.push(new TextRun({ text: t.text, font: 'Consolas', bold: style.bold, italics: style.italics }));
    } else if (t.type === 'link') {
      const inner = t.tokens && t.tokens.length ? t.tokens : [{ type: 'text', text: t.text || t.href || '' }];
      runs.push(...inlineRuns(inner, style));
    } else if (t.type === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
    } else if (t.tokens && t.tokens.length) {
      runs.push(...inlineRuns(t.tokens, style));
    } else if (typeof t.text === 'string' && t.text) {
      runs.push(new TextRun({ text: t.text, bold: style.bold, italics: style.italics }));
    } else if (typeof t.raw === 'string' && t.raw) {
      runs.push(new TextRun({ text: t.raw, bold: style.bold, italics: style.italics }));
    }
  }
  return runs;
}

function listItemInlines(item: any): TextRun[] {
  const inline: any[] = [];
  for (const t of item.tokens || []) {
    if (t.type === 'text' || t.type === 'paragraph') inline.push(...(t.tokens || [{ type: 'text', text: t.text || '' }]));
  }
  return inlineRuns(inline);
}

function listParagraphs(tok: any, level: number): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of tok.items || []) {
    out.push(
      new Paragraph(
        tok.ordered
          ? { children: listItemInlines(item), numbering: { reference: ORDERED_REF, level } }
          : { children: listItemInlines(item), bullet: { level } },
      ),
    );
    for (const sub of item.tokens || []) {
      if (sub.type === 'list' && level < 1) out.push(...listParagraphs(sub, level + 1));
    }
  }
  return out;
}

function blockChildren(tokens: any[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min(6, Math.max(1, tok.depth)) - 1],
            children: inlineRuns(tok.tokens),
          }),
        );
        break;
      case 'paragraph':
        out.push(new Paragraph({ children: inlineRuns(tok.tokens) }));
        break;
      case 'list':
        out.push(...listParagraphs(tok, 0));
        break;
      case 'table': {
        const headerRow = new TableRow({
          children: (tok.header || []).map(
            (cell: any) =>
              new TableCell({ children: [new Paragraph({ children: inlineRuns(cell.tokens, { bold: true }) })] }),
          ),
        });
        const bodyRows = (tok.rows || []).map(
          (row: any[]) =>
            new TableRow({
              children: row.map(
                (cell: any) => new TableCell({ children: [new Paragraph({ children: inlineRuns(cell.tokens) })] }),
              ),
            }),
        );
        out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }));
        break;
      }
      case 'blockquote':
        for (const child of blockChildren(tok.tokens || [])) out.push(child);
        break;
      case 'code':
        for (const line of String(tok.text || '').split('\n')) {
          out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
        }
        break;
      case 'hr':
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1 } },
            children: [],
          }),
        );
        break;
      case 'space':
        break;
      default:
        if (typeof tok.raw === 'string' && tok.raw.trim()) {
          out.push(new Paragraph({ children: [new TextRun(tok.raw.trim())] }));
        }
        break;
    }
  }
  return out;
}

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('markdown must be a non-empty string with the full document content.');
  }
  const children = blockChildren(lexer(markdown));
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: ORDERED_REF,
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.DECIMAL, text: '%2.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
