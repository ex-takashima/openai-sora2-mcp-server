#!/usr/bin/env node

/**
 * OpenAI Sora 2 Batch Processing CLI
 *
 * Execute multiple video generation jobs from a configuration file
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

import { BatchManager } from '../utils/batch-manager.js';
import {
  loadBatchConfig,
  validateBatchConfig,
  mergeBatchConfig,
} from '../utils/batch-config.js';
import type { BatchExecutionOptions, BatchResult, CostEstimate } from '../types/batch.js';

// Load environment variables
dotenv.config();

const VERSION = '1.0.0';

interface ParsedArgs {
  configPath?: string;
  options: BatchExecutionOptions;
  showHelp: boolean;
  showVersion: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const result: ParsedArgs = {
    options: {},
    showHelp: false,
    showVersion: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        result.showHelp = true;
        break;

      case '--version':
      case '-v':
        result.showVersion = true;
        break;

      case '--output-dir':
        result.options.outputDir = args[++i];
        break;

      case '--format':
        const format = args[++i];
        if (format !== 'text' && format !== 'json') {
          console.error(`Invalid format: ${format}. Use 'text' or 'json'.`);
          process.exit(1);
        }
        result.options.format = format;
        break;

      case '--timeout':
        result.options.timeout = parseInt(args[++i], 10);
        break;

      case '--max-concurrent':
        result.options.maxConcurrent = parseInt(args[++i], 10);
        break;

      case '--poll-interval':
        result.options.pollInterval = parseInt(args[++i], 10);
        break;

      case '--max-poll-attempts':
        result.options.maxPollAttempts = parseInt(args[++i], 10);
        break;

      case '--estimate-only':
        result.options.estimateOnly = true;
        break;

      case '--allow-any-path':
        result.options.allowAnyPath = true;
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        // Assume it's the config path
        result.configPath = arg;
        break;
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
OpenAI Sora 2 Batch Processing CLI v${VERSION}

Usage: sora2-batch <config.json> [options]

Arguments:
  config.json          Path to batch configuration file

Options:
  --output-dir <path>       Output directory for generated videos
  --format <text|json>      Output format (default: text)
  --timeout <ms>            Total batch timeout in milliseconds
  --max-concurrent <n>      Maximum concurrent jobs (1-5, default: 2)
  --poll-interval <ms>      Polling interval in ms (default: 15000)
  --max-poll-attempts <n>   Maximum polling attempts
  --estimate-only           Only estimate cost without executing
  --allow-any-path          Allow absolute output paths outside output_dir
  -h, --help                Show this help message
  -v, --version             Show version

Environment Variables:
  OPENAI_API_KEY           Required: OpenAI API key
  DEBUG                    Set to 'true' for debug logging
  OUTPUT_DIR               Default output directory
  VIDEO_POLL_INTERVAL      Default polling interval
  VIDEO_MAX_POLL_ATTEMPTS  Default max polling attempts

Example:
  sora2-batch batch-config.json --output-dir ./output --max-concurrent 3

Config File Format:
  {
    "jobs": [
      {
        "prompt": "A cat playing piano in a jazz bar",
        "seconds": 8,
        "size": "1280x720"
      }
    ],
    "output_dir": "./output",
    "max_concurrent": 2,
    "default_model": "sora-2"
  }
`);
}

/**
 * Format cost estimate for display
 */
function formatCostEstimate(estimate: CostEstimate): string {
  const lines: string[] = [];
  lines.push('Cost Estimate');
  lines.push('=============');
  lines.push('');
  lines.push(`Total Jobs: ${estimate.total_jobs}`);
  lines.push('');
  lines.push('Breakdown:');

  for (const item of estimate.breakdown) {
    const typeLabel =
      item.type === 'text_to_video'
        ? 'Text-to-Video'
        : item.type === 'image_to_video'
          ? 'Image-to-Video'
          : 'Remix';
    lines.push(`  ${typeLabel}: ${item.count} job(s) - $${item.estimated_cost.toFixed(2)}`);
  }

  lines.push('');
  lines.push(`Estimated Cost: $${estimate.estimated_min.toFixed(2)} - $${estimate.estimated_max.toFixed(2)}`);
  lines.push('');
  lines.push('Note: Actual cost may vary based on API pricing and retries.');

  return lines.join('\n');
}

/**
 * Format batch result for text display
 */
function formatBatchResultText(result: BatchResult): string {
  const lines: string[] = [];

  lines.push('Batch Execution Results');
  lines.push('=======================');
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Total Jobs: ${result.total}`);
  lines.push(`  Succeeded: ${result.succeeded}`);
  lines.push(`  Failed: ${result.failed}`);
  lines.push(`  Cancelled: ${result.cancelled}`);
  lines.push('');
  lines.push(`Started: ${result.started_at}`);
  lines.push(`Finished: ${result.finished_at}`);
  lines.push(`Duration: ${(result.total_duration_ms / 1000).toFixed(1)} seconds`);

  if (result.estimated_cost !== undefined) {
    lines.push(`Estimated Cost: $${result.estimated_cost.toFixed(2)}`);
  }

  lines.push('');
  lines.push('Job Results:');
  lines.push('------------');

  for (const job of result.results) {
    lines.push('');
    lines.push(`Job ${job.index}:`);
    lines.push(`  Prompt: ${job.prompt.substring(0, 60)}${job.prompt.length > 60 ? '...' : ''}`);
    lines.push(`  Status: ${job.status}`);

    if (job.output_path) {
      lines.push(`  Output: ${job.output_path}`);
    }

    if (job.video_id) {
      lines.push(`  Video ID: ${job.video_id}`);
    }

    if (job.video_duration) {
      lines.push(`  Duration: ${job.video_duration}s`);
    }

    if (job.duration_ms) {
      lines.push(`  Processing Time: ${(job.duration_ms / 1000).toFixed(1)}s`);
    }

    if (job.error) {
      lines.push(`  Error: ${job.error}`);
    }

    if (job.is_remix) {
      lines.push(`  Type: Remix`);
    } else if (job.is_image_to_video) {
      lines.push(`  Type: Image-to-Video`);
    }
  }

  return lines.join('\n');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const { configPath, options, showHelp, showVersion } = parseArgs();

  if (showVersion) {
    console.log(`sora2-batch v${VERSION}`);
    process.exit(0);
  }

  if (showHelp || !configPath) {
    printHelp();
    process.exit(showHelp ? 0 : 1);
  }

  // Check API key (not required for estimate-only mode)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !options.estimateOnly) {
    console.error('Error: OPENAI_API_KEY environment variable is required.');
    process.exit(1);
  }

  try {
    // Load and validate configuration
    console.log(`Loading configuration from: ${configPath}`);
    const rawConfig = await loadBatchConfig(configPath);
    validateBatchConfig(rawConfig);

    // Merge with options
    const config = mergeBatchConfig(rawConfig, options);
    console.log(`Loaded ${config.jobs.length} job(s)`);

    // Create batch manager (use empty string for estimate-only mode)
    const manager = new BatchManager(apiKey || '');

    // Estimate only mode
    if (options.estimateOnly) {
      const estimate = manager.estimateBatchCost(config);

      if (options.format === 'json') {
        console.log(JSON.stringify(estimate, null, 2));
      } else {
        console.log('');
        console.log(formatCostEstimate(estimate));
      }

      process.exit(0);
    }

    // Execute batch
    console.log('');
    console.log('Starting batch execution...');
    console.log(`Max concurrent: ${config.max_concurrent}`);
    console.log(`Poll interval: ${config.poll_interval}ms`);
    console.log(`Output directory: ${config.output_dir}`);
    console.log('');

    const result = await manager.executeBatch(config, options);

    // Output results
    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('');
      console.log(formatBatchResultText(result));
    }

    // Exit with appropriate code
    if (result.failed > 0 || result.cancelled > 0) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Run
main();
