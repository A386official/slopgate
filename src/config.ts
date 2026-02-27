import * as yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Schema for the .slopgate.yml configuration file.
 * All fields are optional with sensible defaults.
 */
const ThresholdsSchema = z.object({
  warn: z.number().min(0).max(100).default(30),
  flag: z.number().min(0).max(100).default(60),
  block: z.number().min(0).max(100).default(80),
});

const WeightsSchema = z.object({
  velocity: z.number().min(0).max(100).default(80),
  abandonment: z.number().min(0).max(100).default(60),
  shotgun: z.number().min(0).max(100).default(90),
  new_account: z.number().min(0).max(100).default(20),
  placeholder: z.number().min(0).max(100).default(70),
  hallucinated_import: z.number().min(0).max(100).default(90),
  docstring_inflation: z.number().min(0).max(100).default(40),
  copy_paste: z.number().min(0).max(100).default(60),
  generic_description: z.number().min(0).max(100).default(50),
  oversized_diff: z.number().min(0).max(100).default(60),
  unrelated_changes: z.number().min(0).max(100).default(40),
  formatting_only: z.number().min(0).max(100).default(30),
});

const AllowlistSchema = z.object({
  users: z.array(z.string()).default([]),
  bots: z.array(z.string()).default([
    'dependabot[bot]',
    'renovate[bot]',
    'github-actions[bot]',
  ]),
});

const ConfigSchema = z.object({
  thresholds: ThresholdsSchema.default({}),
  auto_close: z.boolean().default(false),
  weights: WeightsSchema.default({}),
  allowlist: AllowlistSchema.default({}),
});

export type SlopGateConfig = z.infer<typeof ConfigSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type Weights = z.infer<typeof WeightsSchema>;
export type Allowlist = z.infer<typeof AllowlistSchema>;

/**
 * Default configuration used when no .slopgate.yml is present.
 */
export const DEFAULT_CONFIG: SlopGateConfig = ConfigSchema.parse({});

/**
 * Parse a YAML configuration string into a validated SlopGateConfig.
 * Missing fields are filled with defaults.
 */
export function parseConfig(yamlContent: string): SlopGateConfig {
  const raw = yaml.load(yamlContent);
  if (raw === null || raw === undefined) {
    return DEFAULT_CONFIG;
  }
  return ConfigSchema.parse(raw);
}

/**
 * Load configuration, falling back to defaults if content is empty or invalid.
 */
export function loadConfig(yamlContent: string | null): SlopGateConfig {
  if (!yamlContent || yamlContent.trim() === '') {
    return DEFAULT_CONFIG;
  }
  try {
    return parseConfig(yamlContent);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Check if a user or bot is on the allowlist.
 */
export function isAllowlisted(
  config: SlopGateConfig,
  username: string,
  isBot: boolean = false
): boolean {
  if (isBot && config.allowlist.bots.includes(username)) {
    return true;
  }
  if (config.allowlist.users.includes(username)) {
    return true;
  }
  return false;
}
