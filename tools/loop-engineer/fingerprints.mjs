// Fingerprint helpers: content hashing + stale detection for loop inputs.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';

export function hashString(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// Fingerprint a single file. Missing file -> sha256 === null (a real signal, not a crash).
export function fingerprintFile(absPath) {
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    return { exists: false, sha256: null };
  }
  return { exists: true, sha256: hashString(readFileSync(absPath)) };
}

// Compare a stored fingerprint object against freshly computed values.
// Both are shape { <name>: { path, sha256 } }. Returns { stale, changed: [names] }.
export function compareFingerprints(stored, current) {
  const changed = [];
  const names = new Set([...Object.keys(stored || {}), ...Object.keys(current || {})]);
  for (const name of names) {
    const a = (stored || {})[name] || {};
    const b = (current || {})[name] || {};
    if (a.sha256 !== b.sha256 || a.commit !== b.commit || a.version !== b.version) {
      changed.push(name);
    }
  }
  return { stale: changed.length > 0, changed };
}

// Given a loop's declared inputs (name -> {path?, commit?, version?}), compute the
// current fingerprint by hashing any file paths relative to root.
export function computeInputFingerprints(inputs, root, join) {
  const out = {};
  for (const [name, spec] of Object.entries(inputs || {})) {
    const entry = { ...spec };
    if (spec && spec.path) {
      const fp = fingerprintFile(join(root, spec.path));
      entry.sha256 = fp.sha256;
      entry.exists = fp.exists;
    }
    out[name] = entry;
  }
  return out;
}

export default { hashString, fingerprintFile, compareFingerprints, computeInputFingerprints };
