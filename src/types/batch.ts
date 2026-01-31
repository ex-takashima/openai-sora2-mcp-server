/**
 * Batch Processing Types
 */

import type { Model, Size } from './tools.js';

/**
 * Single job configuration in batch
 */
export interface BatchJobConfig {
  prompt: string;
  output_path?: string;
  model?: Model;
  size?: Size;
  seconds?: number;
  input_reference?: string; // Image-to-Video
  remix_video_id?: string; // Remix
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  max_retries?: number; // 0-5, default 2
  retry_delay_ms?: number; // 100-60000, default 1000
  retry_on_errors?: string[]; // Default: ['rate_limit', 'timeout', '429', '503']
}

/**
 * Batch configuration file structure
 */
export interface BatchConfig {
  jobs: BatchJobConfig[];
  output_dir?: string;
  max_concurrent?: number; // 1-5 (API rate limit consideration)
  timeout?: number; // Total batch timeout in ms
  poll_interval?: number; // default: 15000 (15 seconds)
  max_poll_attempts?: number;
  retry_policy?: RetryPolicy;
  default_model?: Model;
  default_size?: Size;
  default_seconds?: number;
}

/**
 * Batch execution options (from CLI or environment)
 */
export interface BatchExecutionOptions {
  outputDir?: string;
  format?: 'text' | 'json';
  timeout?: number;
  maxConcurrent?: number;
  pollInterval?: number;
  maxPollAttempts?: number;
  estimateOnly?: boolean;
  allowAnyPath?: boolean;
}

/**
 * Individual job result
 */
export interface BatchJobResult {
  index: number; // 1-based
  prompt: string;
  status: 'completed' | 'failed' | 'cancelled';
  output_path?: string;
  video_url?: string;
  video_id?: string;
  error?: string;
  duration_ms?: number;
  video_duration?: number;
  is_remix?: boolean;
  is_image_to_video?: boolean;
}

/**
 * Batch execution result
 */
export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  results: BatchJobResult[];
  started_at: string;
  finished_at: string;
  total_duration_ms: number;
  estimated_cost?: number;
}

/**
 * Cost estimation result
 */
export interface CostEstimate {
  total_jobs: number;
  estimated_min: number;
  estimated_max: number;
  breakdown: CostBreakdownItem[];
}

export interface CostBreakdownItem {
  type: 'text_to_video' | 'image_to_video' | 'remix';
  count: number;
  estimated_cost: number;
}

/**
 * Default values for batch processing
 */
export const BATCH_DEFAULTS = {
  max_concurrent: 2,
  timeout: 1800000, // 30 minutes
  poll_interval: 15000, // 15 seconds
  max_poll_attempts: 120,
  retry_max_retries: 2,
  retry_delay_ms: 1000,
  retry_on_errors: ['rate_limit', 'timeout', '429', '503', '500'],
} as const;

/**
 * Batch limits
 */
export const BATCH_LIMITS = {
  min_jobs: 1,
  max_jobs: 100,
  min_concurrent: 1,
  max_concurrent: 5,
  min_timeout: 60000, // 1 minute
  max_timeout: 3600000, // 1 hour
  min_poll_interval: 5000, // 5 seconds
  max_poll_interval: 60000, // 1 minute
  min_retry: 0,
  max_retry: 5,
  min_retry_delay: 100,
  max_retry_delay: 60000,
} as const;
