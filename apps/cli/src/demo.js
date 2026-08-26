// WC-005 product surface entrypoint.
//
//   npm run demo                              → complete synthetic audit (no credentials)
//   npm run demo -- --input FILE              → real read-only mode over adapter-normalized records
//   npm run demo -- --core-audit FILE         → canonical-core mode over a TenantLedger.audit() export
//   npm run demo -- --out DIR                 → also write audit-report.md / audit-report.json
//
// The surface never parses raw provider payloads: input must be either the
// versioned normalized bundle emitted by an adapter (see
// docs/NORMALIZED_INPUT.md) or a versioned packages/core audit export — one
// canonical model does the economics.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildAuditReport, buildReportFromCoreAudit } from "./audit.js";
import { renderMarkdownReport, renderJsonReport } from "./report/markdown.js";
import { loadSyntheticFixture } from "./synthetic.js";

function parseArgs(argv) {
  const args = { input: null, coreAudit: null, out: null, format: "md" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[++i] ?? null;
    } else if (arg === "--core-audit") {
      args.coreAudit = argv[++i] ?? null;
    } else if (arg === "--out") {
      args.out = argv[++i] ?? null;
    } else if (arg === "--format") {
      args.format = argv[++i] ?? "md";
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  if (!["md", "json", "both"].includes(args.format)) {
    throw new Error(`--format must be md|json|both (got "${args.format}")`);
  }
  if (args.input && args.coreAudit) {
    throw new Error("--input and --core-audit are mutually exclusive ingestion seams");
  }
  return args;
}

export function printHelp() {
  return `Beetlejuice audit CLI (read-only)

Usage:
  node apps/cli/src/demo.js [options]

Options:
  --input <file>       Path to a versioned NORMALIZED bundle of agentic_task records
                       (adapter output; schema v2). Omit to run the bundled synthetic demo.
  --core-audit <file>  Path to a versioned packages/core TenantLedger.audit() export
                       (canonical-core seam: one canonical model does the economics).
  --out <dir>          Write audit-report.md and/or audit-report.json into <dir>.
  --format <fmt>       md | json | both (stdout format; files honor it too)
  -h, --help           Show this help.

Modes:
  default                synthetic-demo — complete audit from the bundled fixture,
                         zero GitHub credentials required.
  --input <file>         normalized-input — real read-only mode. Raw provider
                         payloads are rejected by design.
  --core-audit <file>    canonical-core — renders packages/core audit output verbatim.`;
}

function readJsonFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    return { error: `cannot read input file "${filePath}": ${error.message}` };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (error) {
    return { error: `input is not valid JSON: ${error.message}` };
  }
}

/**
 * Programmatic entrypoint. Returns a process exit code.
 * @param {string[]} argv
 */
export async function runCli(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n\n${printHelp()}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(`${printHelp()}\n`);
    return 0;
  }

  let report;
  if (args.input || args.coreAudit) {
    const filePath = args.input ?? args.coreAudit;
    const parsed = readJsonFile(filePath);
    if (parsed.error) {
      process.stderr.write(`error: ${parsed.error}\n`);
      return 2;
    }
    try {
      report = args.input
        ? buildAuditReport(parsed.value, { mode: "normalized-input" })
        : buildReportFromCoreAudit(parsed.value, { mode: "canonical-core" });
    } catch (error) {
      const errors = error.validation_errors ?? [];
      process.stderr.write(
        `INVALID ${args.input ? "NORMALIZED INPUT" : "CORE AUDIT EXPORT"} (${error.message})\n`
      );
      for (const e of errors.slice(0, 20)) {
        process.stderr.write(`  - ${e.path}: ${e.message}\n`);
      }
      if (errors.length > 20) process.stderr.write(`  … and ${errors.length - 20} more\n`);
      process.stderr.write(
        `\nThe product surface consumes ONLY adapter-normalized canonical records or canonical-core exports.\nSee apps/cli/docs/NORMALIZED_INPUT.md for the contracts.\n`
      );
      return 2;
    }
  } else {
    report = buildAuditReport(loadSyntheticFixture(), { mode: "synthetic-demo" });
  }

  const json = renderJsonReport(report);
  const markdown = args.format === "json" ? undefined : renderMarkdownReport(report);

  if (args.format === "json") {
    process.stdout.write(json);
  } else {
    process.stdout.write(markdown);
  }

  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    const written = [];
    if (markdown !== undefined) {
      const mdPath = path.join(args.out, "audit-report.md");
      writeFileSync(mdPath, markdown);
      written.push(mdPath);
    }
    const jsonPath = path.join(args.out, "audit-report.json");
    writeFileSync(jsonPath, json);
    written.push(jsonPath);
    process.stdout.write(`\n---\nreports written:\n${written.map((p) => `  ${p}`).join("\n")}\n`);
  }

  return 0;
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
