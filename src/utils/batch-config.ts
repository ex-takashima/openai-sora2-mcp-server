/**
 * Batch configuration loading and validation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  type BatchConfig,
  type BatchJobConfig,
  type BatchExecutionOptions,
  BATCH_DEFAULTS,
  BATCH_LIMITS,
} from '../types/batch.js';
import {
  MODELS,
  SIZES,
  DURATIONS,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  DEFAULT_SECONDS,
  isValidModel,
  isValidSize,
  isValidDuration,
} from '../types/tools.js';

/**
 * Load batch configuration from JSON file
 */
export async function loadBatchConfig(configPath: string): Promise<BatchConfig> {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  const content = await fs.readFile(absolutePath, 'utf-8');
  const config = JSON.parse(content) as BatchConfig;

  return config;
}

/**
 * Validate a single job configuration
 */
function validateJobConfig(job: BatchJobConfig, index: number): void {
  const jobLabel = `Job ${index + 1}`;

  // Prompt is required
  if (!job.prompt || typeof job.prompt !== 'string' || !job.prompt.trim()) {
    throw new Error(`${jobLabel}: prompt is required and must be a non-empty string`);
  }

  // Validate model if specified
  if (job.model !== undefined && !isValidModel(job.model)) {
    throw new Error(
      `${jobLabel}: invalid model '${job.model}'. Valid models: ${MODELS.join(', ')}`
    );
  }

  // Validate size if specified
  if (job.size !== undefined && !isValidSize(job.size)) {
    throw new Error(
      `${jobLabel}: invalid size '${job.size}'. Valid sizes: ${SIZES.join(', ')}`
    );
  }

  // Validate seconds if specified
  if (job.seconds !== undefined) {
    const model = job.model || DEFAULT_MODEL;
    if (!isValidDuration(model, job.seconds)) {
      const validDurations = DURATIONS[model];
      throw new Error(
        `${jobLabel}: invalid seconds '${job.seconds}' for model '${model}'. Valid durations: ${validDurations.join(', ')}`
      );
    }
  }

  // Cannot have both remix_video_id and input_reference
  if (job.remix_video_id && job.input_reference) {
    throw new Error(
      `${jobLabel}: cannot specify both remix_video_id and input_reference`
    );
  }

  // Remix jobs cannot have seconds/size
  if (job.remix_video_id) {
    if (job.seconds !== undefined) {
      throw new Error(`${jobLabel}: remix jobs cannot specify seconds`);
    }
    if (job.size !== undefined) {
      throw new Error(`${jobLabel}: remix jobs cannot specify size`);
    }
    if (job.model !== undefined) {
      throw new Error(`${jobLabel}: remix jobs cannot specify model`);
    }
  }
}

/**
 * Validate entire batch configuration
 */
export function validateBatchConfig(config: BatchConfig): void {
  // Validate jobs array
  if (!config.jobs || !Array.isArray(config.jobs)) {
    throw new Error('jobs must be an array');
  }

  if (config.jobs.length < BATCH_LIMITS.min_jobs) {
    throw new Error(`jobs must contain at least ${BATCH_LIMITS.min_jobs} job`);
  }

  if (config.jobs.length > BATCH_LIMITS.max_jobs) {
    throw new Error(`jobs cannot exceed ${BATCH_LIMITS.max_jobs} jobs`);
  }

  // Validate each job
  for (let i = 0; i < config.jobs.length; i++) {
    validateJobConfig(config.jobs[i], i);
  }

  // Validate max_concurrent
  if (config.max_concurrent !== undefined) {
    if (
      config.max_concurrent < BATCH_LIMITS.min_concurrent ||
      config.max_concurrent > BATCH_LIMITS.max_concurrent
    ) {
      throw new Error(
        `max_concurrent must be between ${BATCH_LIMITS.min_concurrent} and ${BATCH_LIMITS.max_concurrent}`
      );
    }
  }

  // Validate timeout
  if (config.timeout !== undefined) {
    if (
      config.timeout < BATCH_LIMITS.min_timeout ||
      config.timeout > BATCH_LIMITS.max_timeout
    ) {
      throw new Error(
        `timeout must be between ${BATCH_LIMITS.min_timeout}ms and ${BATCH_LIMITS.max_timeout}ms`
      );
    }
  }

  // Validate poll_interval
  if (config.poll_interval !== undefined) {
    if (
      config.poll_interval < BATCH_LIMITS.min_poll_interval ||
      config.poll_interval > BATCH_LIMITS.max_poll_interval
    ) {
      throw new Error(
        `poll_interval must be between ${BATCH_LIMITS.min_poll_interval}ms and ${BATCH_LIMITS.max_poll_interval}ms`
      );
    }
  }

  // Validate retry_policy
  if (config.retry_policy) {
    const rp = config.retry_policy;
    if (rp.max_retries !== undefined) {
      if (rp.max_retries < BATCH_LIMITS.min_retry || rp.max_retries > BATCH_LIMITS.max_retry) {
        throw new Error(
          `retry_policy.max_retries must be between ${BATCH_LIMITS.min_retry} and ${BATCH_LIMITS.max_retry}`
        );
      }
    }
    if (rp.retry_delay_ms !== undefined) {
      if (
        rp.retry_delay_ms < BATCH_LIMITS.min_retry_delay ||
        rp.retry_delay_ms > BATCH_LIMITS.max_retry_delay
      ) {
        throw new Error(
          `retry_policy.retry_delay_ms must be between ${BATCH_LIMITS.min_retry_delay}ms and ${BATCH_LIMITS.max_retry_delay}ms`
        );
      }
    }
  }

  // Validate default values
  if (config.default_model !== undefined && !isValidModel(config.default_model)) {
    throw new Error(
      `invalid default_model '${config.default_model}'. Valid models: ${MODELS.join(', ')}`
    );
  }

  if (config.default_size !== undefined && !isValidSize(config.default_size)) {
    throw new Error(
      `invalid default_size '${config.default_size}'. Valid sizes: ${SIZES.join(', ')}`
    );
  }
}

/**
 * Merge batch configuration with CLI options and environment
 * Precedence: CLI options > environment > config file > defaults
 */
export function mergeBatchConfig(
  config: BatchConfig,
  options: BatchExecutionOptions
): BatchConfig {
  const envPollInterval = process.env.VIDEO_POLL_INTERVAL
    ? parseInt(process.env.VIDEO_POLL_INTERVAL, 10)
    : undefined;
  const envMaxPollAttempts = process.env.VIDEO_MAX_POLL_ATTEMPTS
    ? parseInt(process.env.VIDEO_MAX_POLL_ATTEMPTS, 10)
    : undefined;
  const envOutputDir = process.env.OUTPUT_DIR;

  return {
    ...config,
    output_dir:
      options.outputDir ||
      envOutputDir ||
      config.output_dir ||
      './output',
    max_concurrent:
      options.maxConcurrent ||
      config.max_concurrent ||
      BATCH_DEFAULTS.max_concurrent,
    timeout:
      options.timeout ||
      config.timeout ||
      BATCH_DEFAULTS.timeout,
    poll_interval:
      options.pollInterval ||
      envPollInterval ||
      config.poll_interval ||
      BATCH_DEFAULTS.poll_interval,
    max_poll_attempts:
      options.maxPollAttempts ||
      envMaxPollAttempts ||
      config.max_poll_attempts ||
      BATCH_DEFAULTS.max_poll_attempts,
    default_model: config.default_model || DEFAULT_MODEL,
    default_size: config.default_size || DEFAULT_SIZE,
    default_seconds: config.default_seconds || DEFAULT_SECONDS,
  };
}

/**
 * Resolve output path for a job
 */
export function resolveOutputPath(
  job: BatchJobConfig,
  index: number,
  outputDir: string,
  allowAnyPath: boolean = false
): string {
  if (job.output_path) {
    // If absolute path, check if within output_dir (unless allowAnyPath)
    if (path.isAbsolute(job.output_path)) {
      if (!allowAnyPath) {
        const absoluteOutputDir = path.resolve(outputDir);
        if (!job.output_path.startsWith(absoluteOutputDir)) {
          throw new Error(
            `Job ${index + 1}: absolute output_path must be within output_dir. Use --allow-any-path to override.`
          );
        }
      }
      return job.output_path;
    }
    // Relative path: join with output_dir
    return path.join(outputDir, job.output_path);
  }

  // Auto-generate name based on job type
  let prefix: string;
  if (job.remix_video_id) {
    prefix = 'remixed';
  } else if (job.input_reference) {
    prefix = 'animated';
  } else {
    prefix = 'generated';
  }

  return path.join(outputDir, `${prefix}_${index + 1}.mp4`);
}
