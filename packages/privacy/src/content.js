/**
 * Content defense — the last technical line before a value may enter a
 * global record.
 *
 * Even though the GlobalLearningRecord is a closed schema of enums and
 * buckets, every string value is scanned anyway (defense in depth). The
 * scanner detects:
 *
 * - credential-shaped values (provider token shapes, JWTs, bearer prefixes,
 *   private-key material, key/value assignments);
 * - deterministic identifiers that must never act as join keys: long hex
 *   digests and UUIDs. A hash is NOT anonymization; hashed repo/user names
 *   remain linkable, so they are rejected, not normalized;
 * - URLs / hosts, emails, IP addresses, filesystem paths;
 * - PR/issue reference patterns (`#123`, `issue 42`);
 * - free-text-like values (overlong or multiline) that suggest raw prompts,
 *   diffs, logs or source code;
 * - high-entropy blobs that look like generated secrets.
 *
 * Findings never echo the offending value back: reasons carry only a redacted
 * description so secrets cannot leak through error/report channels.
 */

/** Values at least this long are treated as suspicious free text. */
export const MAX_LITERAL_LENGTH = 96;

/** Minimum length before the entropy heuristic applies. */
export const HIGH_ENTROPY_MIN_LENGTH = 20;

/** Shannon-entropy bits/char above which a long value is a probable secret. */
export const HIGH_ENTROPY_BITS = 4.0;

/**
 * Shape detectors. These encode credential FORMS for detection only; no
 * sample credential ever appears in this repository.
 */
const SHAPE_PATTERNS = [
  { code: "credential_shape_detected", re: /\bgh[a-z]_[A-Za-z0-9]{16,}\b/ },
  { code: "credential_shape_detected", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { code: "credential_shape_detected", re: /\bxox[a-z]-[A-Za-z0-9-]{10,}/ },
  { code: "credential_shape_detected", re: /\bakia[A-Z0-9]{12,}\b/i },
  {
    code: "credential_shape_detected",
    re: /\bey[Jj][A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/,
  },
  { code: "bearer_token_detected", re: /\bbearer\s+[A-Za-z0-9._~+-]{8,}/i },
  { code: "private_key_material_detected", re: /begin [a-z0-9 ]*private[ -]?key/i },
  {
    code: "credential_assignment_detected",
    re: /\b(api[_-]?key|secret|token|passw(or)?d|passwd)\b\s*[:=]\s*\S/i,
  },
  { code: "url_detected", re: /\b[a-z][a-z0-9+.-]*:\/\//i },
  { code: "email_detected", re: /[^\s:@]+@[^\s:@]+\.[^\s:@]/ },
  { code: "ip_address_detected", re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/ },
  // Long hex runs are digests/hashes (md5/sha1/sha256, commit shas, opaque
  // pseudonyms). They stay linkable across datasets, so they are rejected.
  { code: "hash_like_hex_detected", re: /\b[a-f0-9]{32,}\b/i },
  {
    code: "uuid_detected",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  {
    code: "filesystem_path_detected",
    re: /(?:^|[\s"'`(=:])\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+/,
  },
  { code: "filesystem_path_detected", re: /\b[A-Za-z]:\\/ },
  {
    code: "filesystem_path_detected",
    re: /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}\b/,
  },
  { code: "pr_or_issue_reference_detected", re: /#\d{1,7}\b/ },
  { code: "pr_or_issue_reference_detected", re: /\b(?:pr|issue)[-_ ]?\d{2,}\b/i },
];

/**
 * Shannon entropy in bits per character.
 * @param {string} s
 * @returns {number}
 */
export function shannonEntropy(s) {
  if (!s.length) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Scan one string value for forbidden content.
 * @param {string} value
 * @returns {{findings: string[]}} unique finding codes, in detection order
 */
export function scanString(value) {
  const findings = [];
  if (typeof value !== "string") return { findings };
  const add = (code) => {
    if (!findings.includes(code)) findings.push(code);
  };

  if (value.length > MAX_LITERAL_LENGTH) add("oversized_free_text_detected");
  if (/[\n\r\t]/.test(value)) add("multiline_text_detected");

  for (const { code, re } of SHAPE_PATTERNS) {
    if (re.test(value)) add(code);
  }

  if (
    !findings.includes("oversized_free_text_detected") &&
    value.length >= HIGH_ENTROPY_MIN_LENGTH &&
    shannonEntropy(value) > HIGH_ENTROPY_BITS
  ) {
    add("high_entropy_blob_detected");
  }

  return { findings };
}

/**
 * Scan every string field of an already-built GlobalLearningRecord-shaped
 * object. Returns the first offending field plus all findings so callers can
 * reject with a precise reason without echoing any content.
 *
 * @param {Record<string, unknown>} record flat abstract record
 * @returns {{ok: boolean, field?: string, findings: string[]}}
 */
export function scanGlobalLearningRecord(record) {
  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== "string") continue;
    const { findings } = scanString(value);
    if (findings.length > 0) return { ok: false, field, findings };
  }
  return { ok: true, findings: [] };
}
