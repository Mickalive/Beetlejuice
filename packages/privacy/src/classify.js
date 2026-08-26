/**
 * Semantic classification of tenant-side names into abstract families.
 *
 * Internal/custom agent names and vendor model names are allowed as INPUT
 * (tenant reality) but are always mapped onto a coarse family/class before a
 * GlobalLearningRecord is built. Anything unrecognized becomes "custom" /
 * "other" — the raw name is never echoed into the global dataset, because a
 * custom internal agent name is itself an unnecessary technical fingerprint.
 *
 * These heuristics are intentionally simple. Tenants who know their taxonomy
 * should pass `agent_family` / `model_class` directly; classification is the
 * fallback that still refuses to leak raw names.
 */

import { AGENT_FAMILY, MODEL_CLASS } from "./vocab.js";

/** Normalize separators so keyword matching works across naming styles. */
function normalize(name) {
  return String(name).toLowerCase().replace(/[-_.]+/g, " ");
}

/**
 * Classify a raw agent display name into an agent family.
 * @param {string} name
 * @returns {(typeof AGENT_FAMILY)[number]}
 */
export function classifyAgentFamily(name) {
  const n = normalize(name);
  if (!n) return "custom";
  // CI/automation bots first: "ci", "cd", "bot", "runner", "workflow" as
  // standalone tokens.
  if (/(^| )(ci|cd|bot|runner|workflow)($| )/.test(n)) return "ci_bot";
  if (/(^| )(ide|editor|extension|plugin)($| )/.test(n)) return "ide_assistant";
  if (/(cloud|remote|autonomous|hosted)/.test(n))
    return "cloud_autonomous_agent";
  if (/(orchestr|framework|crew|swarm|graph)/.test(n))
    return "orchestrator_framework";
  if (/(pipeline|script|cron|schedul|job)/.test(n)) return "scripted_pipeline";
  if (/(cli|terminal|shell|coding|code|dev|agent|assistant)/.test(n))
    return "cli_coding_agent";
  return "custom";
}

/**
 * Classify a raw model display name into a model class.
 * @param {string} name
 * @returns {(typeof MODEL_CLASS)[number]}
 */
export function classifyModelClass(name) {
  const n = normalize(name);
  if (!n) return "other";
  if (/(rule|regex|deterministic|scripted|templated)/.test(n))
    return "non_llm_deterministic";
  if (/(reasoning|thinking|deep think)/.test(n)) return "frontier_reasoning";
  if (/(local|self hosted|selfhosted|open weights|oss|offline)/.test(n))
    return "local_open_weights";
  if (/(mini|small|fast|lite|nano|tiny|instant)/.test(n))
    return "small_fast_model";
  if (/(model|llm|gpt class|chat)/.test(n)) return "standard_model";
  return "other";
}
