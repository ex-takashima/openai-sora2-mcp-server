/**
 * Video polling and download utilities
 */

import * as fs from 'fs/promises';
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  type SoraVideoResponse,
  type VideoStatus,
} from '../types/tools.js';
import { debugLog, errorLog } from './debug.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if status indicates completion
 */
function isCompleted(status: VideoStatus): boolean {
  return status === 'completed' || status === 'succeeded';
}

/**
 * Check if status indicates failure
 */
function isFailed(status: VideoStatus): boolean {
  return status === 'failed' || status === 'cancelled';
}

/**
 * Check if status indicates still processing
 */
function isPending(status: VideoStatus): boolean {
  return (
    status === 'queued' ||
    status === 'in_progress' ||
    status === 'running' ||
    status === 'preprocessing' ||
    status === 'processing'
  );
}

/**
 * Progress callback type
 */
export type ProgressCallback = (
  status: VideoStatus,
  attempt: number,
  maxAttempts: number
) => void;

/**
 * Poll for video generation result
 */
export async function pollVideoResult(
  apiKey: string,
  videoId: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS,
  onProgress?: ProgressCallback
): Promise<SoraVideoResponse> {
  debugLog(`Starting poll for video: ${videoId}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${OPENAI_API_BASE}/videos/${videoId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle transient server errors with retry
      if (response.status >= 500 && attempt < maxAttempts) {
        debugLog(`Server error (${response.status}), retrying...`);
        await sleep(pollInterval);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const result = (await response.json()) as SoraVideoResponse;
      debugLog(`Poll attempt ${attempt}: status=${result.status}`);

      // Notify progress
      if (onProgress) {
        onProgress(result.status, attempt, maxAttempts);
      }

      // Check completion
      if (isCompleted(result.status)) {
        debugLog(`Video generation completed: ${videoId}`);
        return result;
      }

      // Check failure
      if (isFailed(result.status)) {
        throw new Error(
          `Video generation failed: ${result.failure_reason || result.error || result.status}`
        );
      }

      // Still pending, wait and retry
      if (attempt < maxAttempts && isPending(result.status)) {
        await sleep(pollInterval);
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      errorLog(`Poll error (attempt ${attempt}), retrying...`, error);
      await sleep(pollInterval);
    }
  }

  throw new Error(
    `Video generation timed out after ${maxAttempts} attempts (${Math.round((maxAttempts * pollInterval) / 60000)} minutes)`
  );
}

/**
 * Download video content from URL
 */
export async function downloadVideo(url: string): Promise<Buffer> {
  debugLog(`Downloading video from: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download video from API content endpoint
 */
export async function downloadVideoFromApi(
  apiKey: string,
  videoId: string
): Promise<Buffer> {
  debugLog(`Downloading video from API: ${videoId}`);

  const response = await fetch(
    `${OPENAI_API_BASE}/videos/${videoId}/content`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to download video: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download and save video to file
 */
export async function downloadAndSaveVideo(
  url: string,
  outputPath: string
): Promise<void> {
  const buffer = await downloadVideo(url);
  await fs.writeFile(outputPath, buffer);
  debugLog(`Video saved to: ${outputPath}`);
}

/**
 * Download from API and save video to file
 */
export async function downloadFromApiAndSave(
  apiKey: string,
  videoId: string,
  outputPath: string
): Promise<void> {
  const buffer = await downloadVideoFromApi(apiKey, videoId);
  await fs.writeFile(outputPath, buffer);
  debugLog(`Video saved to: ${outputPath}`);
}

/**
 * Validate video URL accessibility
 */
export async function validateVideoUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
