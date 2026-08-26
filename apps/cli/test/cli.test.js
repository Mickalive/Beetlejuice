import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/demo.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

const CORE_EXPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/core-audit-export-v1.json"
);

function captureIo(run) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let out = "";
  let err = "";
  process.stdout.write = (chunk) => {
    out += chunk.toString();
    return true;
  };
  process.stderr.write = (chunk) => {
    err += chunk.toString();
    return true;
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    })
    .then((result) => ({ result, out, err }));
}

test("real read-only mode consumes a normalized adapter bundle file without credentials", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-real-"));
  try {
    const input = path.join(dir, "normalized-bundle.json");
    writeFileSync(input, JSON.stringify(loadSyntheticFixture()));
    const { result, out } = await captureIo(() => runCli(["--input", input]));
    assert.equal(result, 0);
    assert.ok(out.includes("# Beetlejuice Audit — Agentic Economics Report"));
    assert.ok(out.includes("normalized-input"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalized mode end-to-end: exit 0, economics on stdout, reports written with --out", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-cli-"));
  try {
    const input = path.join(dir, "bundle.json");
    writeFileSync(input, JSON.stringify(loadSyntheticFixture()));
    const outDir = path.join(dir, "reports-out");

    let code;
    let out;
    await captureIo(async () => {
      code = await runCli(["--input", input, "--out", outDir, "--format", "both"]);
    }).then((io) => {
      out = io.out;
    });

    assert.equal(code, 0);
    assert.ok(out.includes("# Beetlejuice Audit — Agentic Economics Report"));
    assert.ok(out.includes("$28.57"));

    const md = readFileSync(path.join(outDir, "audit-report.md"), "utf8");
    const json = JSON.parse(readFileSync(path.join(outDir, "audit-report.json"), "utf8"));
    assert.equal(json.report_type, "beetlejuice_audit_report");
    assert.equal(json.mode, "normalized-input");
    assert.equal(json.money_unit_at_rest, "micro_usd");
    assert.equal(json.headline.total_measured_cost_micro_usd, 28_570_000);
    assert.ok(md.includes("Certainly avoidable spend"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical-core mode renders a genuine TenantLedger.audit() export end-to-end", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-core-"));
  try {
    const outDir = path.join(dir, "out");
    let code;
    let out;
    await captureIo(async () => {
      code = await runCli(["--core-audit", CORE_EXPORT_PATH, "--out", outDir, "--format", "both"]);
    }).then((io) => {
      out = io.out;
    });
    assert.equal(code, 0);
    assert.ok(out.includes("canonical-core"));
    assert.ok(out.includes("$12.65"));
    assert.ok(out.includes("WASTE_DUP_CI_V1"));

    const json = JSON.parse(readFileSync(path.join(outDir, "audit-report.json"), "utf8"));
    assert.equal(json.mode, "canonical-core");
    assert.equal(json.headline.certainly_avoidable_spend_micro_usd, 5_450_000);
    assert.equal(json.data_quality.accounting_balanced, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("raw GitHub payloads are rejected in real mode with a clear adapter-boundary error", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-raw-"));
  try {
    const rawPayload = {
      // Deliberately a RAW GitHub Actions payload shape — no canonical envelope.
      workflow_run: {
        id: 987654321,
        name: "agent-ci",
        head_sha: "deadbeef",
        conclusion: "success",
        html_url: "https://github.invalid/acme/widget/actions/runs/987654321",
      },
    };
    const input = path.join(dir, "raw-github.json");
    writeFileSync(input, JSON.stringify(rawPayload));

    let code;
    let err;
    await captureIo(async () => {
      code = await runCli(["--input", input]);
    }).then((io) => {
      err = io.err;
    });
    assert.equal(code, 2);
    assert.match(err, /INVALID NORMALIZED INPUT/);
    assert.match(err, /workflow_run/);
    assert.match(err, /normalize/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a raw provider payload smuggled into --core-audit is rejected too", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-core-raw-"));
  try {
    const input = path.join(dir, "smuggled.json");
    writeFileSync(input, JSON.stringify({ check_run: { id: 1 }, audit: {} }));
    let code;
    let err;
    await captureIo(async () => {
      code = await runCli(["--core-audit", input]);
    }).then((io) => {
      err = io.err;
    });
    assert.equal(code, 2);
    assert.match(err, /INVALID CORE AUDIT EXPORT/);
    assert.match(err, /check_run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing file and invalid JSON fail cleanly with nonzero exit codes", async () => {
  let missing;
  await captureIo(async () => {
    missing = await runCli(["--input", "/nonexistent/bundle.json"]);
  });
  assert.equal(missing, 2);

  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-badjson-"));
  try {
    const input = path.join(dir, "bad.json");
    writeFileSync(input, "{not json");
    let badJson;
    await captureIo(async () => {
      badJson = await runCli(["--input", input]);
    });
    assert.equal(badJson, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--input and --core-audit are mutually exclusive seams", async () => {
  let code;
  let err;
  await captureIo(async () => {
    code = await runCli(["--input", "a.json", "--core-audit", "b.json"]);
  }).then((io) => {
    err = io.err;
  });
  assert.equal(code, 2);
  assert.match(err, /mutually exclusive/);
});

test("--help exits 0 and documents the credential-free demo plus both seams", async () => {
  let code;
  let out;
  await captureIo(async () => {
    code = await runCli(["--help"]);
  }).then((io) => {
    out = io.out;
  });
  assert.equal(code, 0);
  assert.match(out, /synthetic demo/i);
  assert.match(out, /NORMALIZED/);
  assert.match(out, /--core-audit/);
});
