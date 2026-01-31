/**
 * Batch execution manager with concurrency control
 */

import {
  type BatchConfig,
  type BatchJobConfig,
  type BatchJobResult,
  type BatchResult,
  type BatchExecutionOptions,
  type CostEstimate,
  type CostBreakdownItem,
  BATCH_DEFAULTS,
} from '../types/batch.js';
import {
  type Model,
  type Size,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  DEFAULT_SECONDS,
  calculateCost,
} from '../types/tools.js';
import { generateVideo, type GenerateVideoOptions } from '../tools/generate.js';
import { remixVideo } from '../tools/remix.js';
import { resolveOutputPath } from './batch-config.js';
import { generateUniqueFilePath } from './path.js';
import { debugLog, errorLog } from './debug.js';

/**
 * Semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error matches retry patterns
 */
function shouldRetry(error: Error, patterns: string[]): boolean {
  const errorMessage = error.message.toLowerCase();
  return patterns.some((pattern) => errorMessage.includes(pattern.toLowerCase()));
}

/**
 * Batch Manager class
 */
export class BatchManager {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Execute a batch of video generation jobs
   */
  async executeBatch(
    config: BatchConfig,
    options: BatchExecutionOptions
  ): Promise<BatchResult> {
    const startedAt = new Date();
    const results: BatchJobResult[] = [];
    const maxConcurrent = config.max_concurrent || BATCH_DEFAULTS.max_concurrent;
    const timeout = config.timeout || BATCH_DEFAULTS.timeout;
    const pollInterval = config.poll_interval || BATCH_DEFAULTS.poll_interval;
    const maxPollAttempts = config.max_poll_attempts || BATCH_DEFAULTS.max_poll_attempts;
    const outputDir = config.output_dir || './output';
    const allowAnyPath = options.allowAnyPath || false;

    const retryPolicy = {
      maxRetries: config.retry_policy?.max_retries ?? BATCH_DEFAULTS.retry_max_retries,
      retryDelay: config.retry_policy?.retry_delay_ms ?? BATCH_DEFAULTS.retry_delay_ms,
      retryPatterns: config.retry_policy?.retry_on_errors ?? [...BATCH_DEFAULTS.retry_on_errors],
    };

    debugLog(`Starting batch execution: ${config.jobs.length} jobs, max concurrent: ${maxConcurrent}`);

    const semaphore = new Semaphore(maxConcurrent);
    const jobPromises: Promise<void>[] = [];
    let timedOut = false;

    // Create job promises
    for (let i = 0; i < config.jobs.length; i++) {
      const job = config.jobs[i];
      const index = i;

      const jobPromise = (async () => {
        await semaphore.acquire();
        try {
          if (timedOut) {
            results.push({
              index: index + 1,
              prompt: job.prompt,
              status: 'cancelled',
              error: 'Batch timed out before job started',
            });
            return;
          }

          const outputPath = resolveOutputPath(job, index, outputDir, allowAnyPath);
          const uniquePath = await generateUniqueFilePath(outputPath);

          const result = await this.executeJobWithRetry(
            job,
            index,
            uniquePath,
            config,
            pollInterval,
            maxPollAttempts,
            retryPolicy
          );

          results.push(result);
        } finally {
          semaphore.release();
        }
      })();

      jobPromises.push(jobPromise);
    }

    // Execute with timeout
    try {
      await Promise.race([
        Promise.all(jobPromises),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true;
            reject(new Error('Batch execution timed out'));
          }, timeout);
        }),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === 'Batch execution timed out') {
        debugLog('Batch timed out, waiting for running jobs to complete...');
        // Wait a bit for currently running jobs to finish
        await sleep(5000);
      } else {
        throw error;
      }
    }

    // Mark any remaining jobs as cancelled
    const processedIndices = new Set(results.map((r) => r.index));
    for (let i = 0; i < config.jobs.length; i++) {
      if (!processedIndices.has(i + 1)) {
        results.push({
          index: i + 1,
          prompt: config.jobs[i].prompt,
          status: 'cancelled',
          error: 'Batch timed out or cancelled',
        });
      }
    }

    // Sort by index
    results.sort((a, b) => a.index - b.index);

    const finishedAt = new Date();
    const succeeded = results.filter((r) => r.status === 'completed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const cancelled = results.filter((r) => r.status === 'cancelled').length;

    return {
      total: config.jobs.length,
      succeeded,
      failed,
      cancelled,
      results,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      total_duration_ms: finishedAt.getTime() - startedAt.getTime(),
      estimated_cost: this.calculateTotalCost(results, config),
    };
  }

  /**
   * Execute a single job with retry logic
   */
  private async executeJobWithRetry(
    job: BatchJobConfig,
    index: number,
    outputPath: string,
    config: BatchConfig,
    pollInterval: number,
    maxPollAttempts: number,
    retryPolicy: { maxRetries: number; retryDelay: number; retryPatterns: string[] }
  ): Promise<BatchJobResult> {
    const jobStartTime = Date.now();
    const model = job.model || config.default_model || DEFAULT_MODEL;
    const size = job.size || config.default_size || DEFAULT_SIZE;
    const seconds = job.seconds || config.default_seconds || DEFAULT_SECONDS;

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
      try {
        debugLog(`Executing job ${index + 1} (attempt ${attempt + 1})`);

        let result;

        if (job.remix_video_id) {
          // Remix job
          result = await remixVideo(this.apiKey, {
            prompt: job.prompt,
            remix_video_id: job.remix_video_id,
            output_path: outputPath,
          }, pollInterval, maxPollAttempts);
        } else {
          // Generate job (text-to-video or image-to-video)
          const generateOptions: GenerateVideoOptions = {
            pollInterval,
            maxPollAttempts,
          };

          result = await generateVideo(
            this.apiKey,
            {
              prompt: job.prompt,
              model,
              size,
              seconds,
              input_reference: job.input_reference,
              output_path: outputPath,
            },
            generateOptions
          );
        }

        if (!result.success) {
          throw new Error(result.error || 'Unknown error');
        }

        return {
          index: index + 1,
          prompt: job.prompt,
          status: 'completed',
          output_path: result.output_path,
          video_url: result.video_url,
          video_id: result.video_id,
          duration_ms: Date.now() - jobStartTime,
          video_duration: result.duration,
          is_remix: !!job.remix_video_id,
          is_image_to_video: !!job.input_reference,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryPolicy.maxRetries && shouldRetry(err, retryPolicy.retryPatterns)) {
          debugLog(`Job ${index + 1} failed, retrying in ${retryPolicy.retryDelay}ms...`);
          await sleep(retryPolicy.retryDelay);
          continue;
        }

        errorLog(`Job ${index + 1} failed permanently`, err);

        return {
          index: index + 1,
          prompt: job.prompt,
          status: 'failed',
          error: err.message,
          duration_ms: Date.now() - jobStartTime,
          is_remix: !!job.remix_video_id,
          is_image_to_video: !!job.input_reference,
        };
      }
    }

    // Should not reach here, but just in case
    return {
      index: index + 1,
      prompt: job.prompt,
      status: 'failed',
      error: 'Max retries exceeded',
      duration_ms: Date.now() - jobStartTime,
    };
  }

  /**
   * Calculate total cost from results
   */
  private calculateTotalCost(results: BatchJobResult[], config: BatchConfig): number {
    let total = 0;

    for (const result of results) {
      if (result.status === 'completed' && result.video_duration) {
        // Find the original job config
        const job = config.jobs[result.index - 1];
        const model = job.model || config.default_model || DEFAULT_MODEL;
        const size = job.size || config.default_size || DEFAULT_SIZE;

        total += calculateCost(model, result.video_duration, size);
      }
    }

    return total;
  }

  /**
   * Estimate cost for a batch without executing
   */
  estimateBatchCost(config: BatchConfig): CostEstimate {
    const breakdown: CostBreakdownItem[] = [];
    let textToVideoCount = 0;
    let imageToVideoCount = 0;
    let remixCount = 0;
    let textToVideoCost = 0;
    let imageToVideoCost = 0;
    let remixCost = 0;

    for (const job of config.jobs) {
      const model = job.model || config.default_model || DEFAULT_MODEL;
      const size = job.size || config.default_size || DEFAULT_SIZE;
      const seconds = job.seconds || config.default_seconds || DEFAULT_SECONDS;

      const cost = calculateCost(model, seconds, size);

      if (job.remix_video_id) {
        remixCount++;
        remixCost += cost;
      } else if (job.input_reference) {
        imageToVideoCount++;
        imageToVideoCost += cost;
      } else {
        textToVideoCount++;
        textToVideoCost += cost;
      }
    }

    if (textToVideoCount > 0) {
      breakdown.push({
        type: 'text_to_video',
        count: textToVideoCount,
        estimated_cost: textToVideoCost,
      });
    }

    if (imageToVideoCount > 0) {
      breakdown.push({
        type: 'image_to_video',
        count: imageToVideoCount,
        estimated_cost: imageToVideoCost,
      });
    }

    if (remixCount > 0) {
      breakdown.push({
        type: 'remix',
        count: remixCount,
        estimated_cost: remixCost,
      });
    }

    const totalEstimate = textToVideoCost + imageToVideoCost + remixCost;

    return {
      total_jobs: config.jobs.length,
      estimated_min: totalEstimate * 0.9, // 10% margin
      estimated_max: totalEstimate * 1.2, // 20% margin
      breakdown,
    };
  }
}
