// Minimal YAML subset (maps, sequences, scalars). Zero dependencies.
// Supports exactly what the Loop Engineer state files use: nested maps, sequences
// of scalars and maps, quoted/bare strings, numbers, booleans, null, {} and [].
// Not a general YAML parser (no anchors, tags, multiline block scalars, flow maps).

function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function findColon(s) {
  let inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === ':' && !inS && !inD && (i + 1 >= s.length || s[i + 1] === ' ')) return i;
  }
  return -1;
}

function unquote(s) {
  if (s.startsWith('"')) return JSON.parse(s);
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function parseScalar(s) {
  const t = s.trim();
  if (t === '' || t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === '{}') return {};
  if (t === '[]') return [];
  if (t[0] === '"' || t[0] === "'") return unquote(t);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

const isSeqLine = (l) => l.content === '-' || l.content.startsWith('- ');

function parseBlock(lines, i) {
  if (i >= lines.length) return [null, i];
  return isSeqLine(lines[i])
    ? parseSeq(lines, i, lines[i].indent)
    : parseMap(lines, i, lines[i].indent);
}

function parseMap(lines, i, indent) {
  const obj = {};
  while (i < lines.length && lines[i].indent === indent && !isSeqLine(lines[i])) {
    const content = lines[i].content;
    const colon = findColon(content);
    if (colon === -1) throw new Error(`YAML: expected "key:" at line "${content}"`);
    const key = unquote(content.slice(0, colon).trim());
    const rest = content.slice(colon + 1).trim();
    i++;
    if (rest !== '') { obj[key] = parseScalar(rest); continue; }
    if (i < lines.length && lines[i].indent > indent) {
      const [val, ni] = parseBlock(lines, i); obj[key] = val; i = ni;
    } else if (i < lines.length && lines[i].indent === indent && isSeqLine(lines[i])) {
      const [val, ni] = parseSeq(lines, i, indent); obj[key] = val; i = ni;
    } else {
      obj[key] = null;
    }
  }
  return [obj, i];
}

function parseSeq(lines, i, indent) {
  const arr = [];
  while (i < lines.length && lines[i].indent === indent && isSeqLine(lines[i])) {
    const after = lines[i].content === '-' ? '' : lines[i].content.slice(2);
    if (after === '') {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        const [val, ni] = parseBlock(lines, i); arr.push(val); i = ni;
      } else arr.push(null);
    } else if (findColon(after) !== -1) {
      const mapIndent = indent + 2;
      const block = [{ indent: mapIndent, content: after }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent >= mapIndent) { block.push(lines[j]); j++; }
      const [val] = parseMap(block, 0, mapIndent);
      arr.push(val); i = j;
    } else {
      arr.push(parseScalar(after)); i++;
    }
  }
  return [arr, i];
}

export function parse(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const s = stripComment(raw);
    if (s.trim() === '' || s.trim() === '---') continue;
    if (/^\t/.test(s)) throw new Error('YAML: tabs are not supported for indentation');
    lines.push({ indent: s.length - s.trimStart().length, content: s.trim() });
  }
  if (lines.length === 0) return null;
  return parseBlock(lines, 0)[0];
}

const NEEDS_QUOTE = /^\s|\s$|[:#\n]|^[-?[\]{},&*!|>'"%@`]|^(true|false|null|~)$|^-?\d/;

function scalarStr(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return s === '' || NEEDS_QUOTE.test(s) ? JSON.stringify(s) : s;
}

const isScalar = (v) => v === null || typeof v !== 'object';
const pad = (n) => ' '.repeat(n);

function dump(value, indent) {
  const lines = [];
  const keys = Object.keys(value);
  for (const key of keys) {
    const k = NEEDS_QUOTE.test(key) ? JSON.stringify(key) : key;
    const v = value[key];
    if (isScalar(v)) { lines.push(`${pad(indent)}${k}: ${scalarStr(v)}`); continue; }
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${pad(indent)}${k}: []`); continue; }
      lines.push(`${pad(indent)}${k}:`);
      lines.push(...dumpSeq(v, indent));
      continue;
    }
    if (Object.keys(v).length === 0) { lines.push(`${pad(indent)}${k}: {}`); continue; }
    lines.push(`${pad(indent)}${k}:`);
    lines.push(...dump(v, indent + 2));
  }
  return lines;
}

function dumpSeq(arr, indent) {
  const lines = [];
  for (const item of arr) {
    if (isScalar(item)) { lines.push(`${pad(indent)}- ${scalarStr(item)}`); continue; }
    if (Array.isArray(item)) {
      if (item.length === 0) { lines.push(`${pad(indent)}- []`); continue; }
      lines.push(`${pad(indent)}-`);
      lines.push(...dumpSeq(item, indent + 2));
      continue;
    }
    if (Object.keys(item).length === 0) { lines.push(`${pad(indent)}- {}`); continue; }
    const mapLines = dump(item, indent + 2);
    mapLines[0] = `${pad(indent)}- ${mapLines[0].slice(indent + 2)}`;
    lines.push(...mapLines);
  }
  return lines;
}

export function stringify(value) {
  if (value === null || typeof value !== 'object') return scalarStr(value) + '\n';
  const lines = Array.isArray(value) ? dumpSeq(value, 0) : dump(value, 0);
  return lines.join('\n') + '\n';
}

export default { parse, stringify };
