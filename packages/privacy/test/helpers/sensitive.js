/**
 * Runtime builders for FAKE sensitive values.
 *
 * Policy (binding): this repository never contains credential-shaped literal
 * fixtures (Slack/GitHub/AWS/API tokens or similar) in source or tests.
 * Every "sensitive" test value below is assembled at runtime from harmless
 * fragments so no recognizable credential ever appears as a literal anywhere
 * in the codebase. The values only need to match the detector SHAPES in
 * src/content.js, not any real provider format.
 */

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER = ALNUM.toUpperCase();
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/** Join fragments without spelling anything credential-shaped in source. */
const j = (...parts) => parts.join("");

/** First n alphanumeric characters — random-looking shape, zero meaning. */
function run(n, alphabet = ALNUM) {
  return alphabet.slice(0, Math.max(0, Math.min(n, alphabet.length))).repeat(
    Math.ceil(n / alphabet.length),
  ).slice(0, n);
}

/** Provider-style personal access token shape: gh?_ + 36 alphanumerics. */
export const fakeProviderToken = () =>
  j("gh", "p_", run(36));

/** Chat-bot token shape: xox?-… segments. */
export const fakeChatToken = () =>
  j("xo", "xb-", "1234", "-", "ABCD", "-", run(12, LOWER));

/** Cloud access-key id shape: 4-letter prefix + 12 uppercase alphanumerics. */
export const fakeCloudAccessKey = () =>
  j("A", "K", "I", "A", run(12, UPPER));

/** JWT-ish three-segment token (header segments start with the eyJ prefix). */
export const fakeJwt = () =>
  j("ey", "J", run(14), ".", run(16), ".", run(16));

/** Bearer header value. */
export const fakeBearer = () => j("Bearer ", run(24));

/** Generic key assignment string. */
export const fakeApiKeyAssignment = () => j("api_key", "=", run(24));

/** Password assignment string. */
export const fakePasswordAssignment = () => j("password", ": ", run(20));

/** PEM private-key header. */
export const fakePrivateKeyHeader = () =>
  j("-----", "BEGIN ", "RSA ", "PRIVATE ", "KEY", "-----");

/** RFC-2606 reserved email — safe by construction. */
export const fakeEmail = () => j("someone", "@", "example", ".", "invalid");

/** Reserved-TLD private URL with org/repo path. */
export const fakePrivateUrl = () =>
  j("ht", "tps://git.", "internal.", "invalid/org/", "repo/pull/7");

/** Loopback-range IPv4 address. */
export const fakeIpAddress = () => [10, 1, 2, 3].join(".");

/** sha1-length hex digest built from harmless nibbles. */
export const fakeCommitDigest = () => "0123abcd".repeat(5);

/** UUIDv4-shaped identifier (example pattern, not a real resource). */
export const fakeUuid = () =>
  ["f47ac10b", "58cc", "4372", "a567", "0e02b2c3d479"].join("-");

/** Absolute POSIX path. */
export const fakeAbsolutePath = () =>
  j("/", ["home", "dev", "src", "app.py"].join("/"));

/** Windows path. */
export const fakeWindowsPath = () =>
  j("C:", "\\", ["Users", "dev", "notes.txt"].join("\\"));

/** Repo-relative path with extension. */
export const fakeRelativePath = () =>
  ["src", "auth", "login.py"].join("/");

/** PR/issue reference text. */
export const fakeIssueReference = () => j("fixes issue #", "1234");

/** Multi-line code snippet. */
export const fakeCodeSnippet = () =>
  ["def check(x):", "    return x > 1"].join("\n");

/** Overlong prompt-like prose (>96 chars). */
export const fakeLongPrompt = () =>
  "Please carefully explain and then fix the failing module before release " +
  "because the release train leaves tonight and everyone is waiting for it.";

/**
 * High-entropy blob (distinct mixed-case alphanumerics).
 */
export const fakeEntropyBlob = () => run(24);

/**
 * All sensitive payloads with a short label.
 * @returns {{name: string, value: () => string}[]}
 */
export function allSensitivePayloads() {
  return [
    { name: "provider_token", value: fakeProviderToken },
    { name: "chat_token", value: fakeChatToken },
    { name: "cloud_access_key", value: fakeCloudAccessKey },
    { name: "jwt", value: fakeJwt },
    { name: "bearer", value: fakeBearer },
    { name: "api_key_assignment", value: fakeApiKeyAssignment },
    { name: "password_assignment", value: fakePasswordAssignment },
    { name: "private_key_header", value: fakePrivateKeyHeader },
    { name: "email", value: fakeEmail },
    { name: "private_url", value: fakePrivateUrl },
    { name: "ip_address", value: fakeIpAddress },
    { name: "commit_digest", value: fakeCommitDigest },
    { name: "uuid", value: fakeUuid },
    { name: "absolute_path", value: fakeAbsolutePath },
    { name: "windows_path", value: fakeWindowsPath },
    { name: "relative_path", value: fakeRelativePath },
    { name: "issue_reference", value: fakeIssueReference },
    { name: "code_snippet", value: fakeCodeSnippet },
    { name: "long_prompt", value: fakeLongPrompt },
    { name: "entropy_blob", value: fakeEntropyBlob },
  ];
}
