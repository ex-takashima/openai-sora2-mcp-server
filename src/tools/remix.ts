/**
 * Video remix tool implementation
 */

import {
  type RemixVideoParams,
  type VideoGenerationResult,
  type SoraVideoResponse,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
} from '../types/tools.js';
import {
  pollVideoResult,
  downloadAndSaveVideo,
  downloadFromApiAndSave,
} from '../utils/video.js';
import {
  normalizeAndValidatePath,
  generateUniqueFilePath,
  getDisplayPath,
} from '../utils/path.js';
import { debugLog, errorLog } from '../utils/debug.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * Validate remix parameters
 */
function validateParams(params: RemixVideoParams): void {
  // Prompt is required
  if (!params.prompt || typeof params.prompt !== 'string' || !params.prompt.trim()) {
    throw new Error('prompt is required and must be a non-empty string');
  }

  // remix_video_id is required
  if (!params.remix_video_id || typeof params.remix_video_id !== 'string' || !params.remix_video_id.trim()) {
    throw new Error('remix_video_id is required and must be a non-empty string');
  }
}

/**
 * Remix an existing video with a new prompt
 */
export async function remixVideo(
  apiKey: string,
  params: RemixVideoParams,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxPollAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS
): Promise<VideoGenerationResult> {
  try {
    // Validate parameters
    validateParams(params);

    debugLog('Remixing video:', { videoId: params.remix_video_id, prompt: params.prompt.substring(0, 50) + '...' });

    // Prepare output path
    let outputPath: string | undefined;
    if (params.output_path) {
      outputPath = await normalizeAndValidatePath(params.output_path);
      outputPath = await generateUniqueFilePath(outputPath);
    }

    // Make API request
    const response = await fetch(
      `${OPENAI_API_BASE}/videos/${params.remix_video_id}/remix`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: params.prompt,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API error: ${response.status}`;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {
        errorMessage = `${errorMessage} - ${errorText}`;
      }

      // Specific error handling
      if (response.status === 401) {
        throw new Error('Authentication failed. Please check your OPENAI_API_KEY.');
      }
      if (response.status === 403) {
        throw new Error('Access denied. Sora 2 requires Tier 2+ API access.');
      }
      if (response.status === 404) {
        throw new Error(`Video not found: ${params.remix_video_id}`);
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait and try again.');
      }

      throw new Error(errorMessage);
    }

    const result = (await response.json()) as SoraVideoResponse;
    const videoId = result.id;

    debugLog(`Remix started: ${videoId} (from ${params.remix_video_id})`);

    // Poll for completion
    const finalResult = await pollVideoResult(
      apiKey,
      videoId,
      pollInterval,
      maxPollAttempts
    );

    debugLog('Remix completed, downloading...');

    // Download and save video
    if (outputPath) {
      if (finalResult.video_url) {
        await downloadAndSaveVideo(finalResult.video_url, outputPath);
      } else {
        await downloadFromApiAndSave(apiKey, videoId, outputPath);
      }

      return {
        success: true,
        video_id: videoId,
        video_url: finalResult.video_url,
        output_path: outputPath,
        duration: finalResult.duration,
      };
    }

    return {
      success: true,
      video_id: videoId,
      video_url: finalResult.video_url,
      duration: finalResult.duration,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    errorLog('Video remix failed', err);

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Format remix result for display
 */
export function formatRemixResult(result: VideoGenerationResult): string {
  if (!result.success) {
    return `Video remix failed: ${result.error}`;
  }

  const lines: string[] = [];
  lines.push('Video remix completed successfully!');
  lines.push('');

  if (result.video_id) {
    lines.push(`New Video ID: ${result.video_id}`);
  }

  if (result.duration) {
    lines.push(`Duration: ${result.duration} seconds`);
  }

  if (result.output_path) {
    lines.push(`Saved to: ${getDisplayPath(result.output_path)}`);
  }

  if (result.video_url) {
    lines.push(`URL: ${result.video_url}`);
  }

  return lines.join('\n');
}
