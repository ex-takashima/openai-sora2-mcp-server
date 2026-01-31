/**
 * Video generation tool implementation
 */

import {
  type GenerateVideoParams,
  type VideoGenerationResult,
  type SoraVideoResponse,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  DEFAULT_SECONDS,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  isValidModel,
  isValidSize,
  isValidDuration,
  MODELS,
  SIZES,
  DURATIONS,
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
  generateDefaultOutputPath,
} from '../utils/path.js';
import { debugLog, errorLog } from '../utils/debug.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * Options for video generation
 */
export interface GenerateVideoOptions {
  pollInterval?: number;
  maxPollAttempts?: number;
  onProgress?: (status: string, attempt: number, maxAttempts: number) => void;
}

/**
 * Validate generation parameters
 */
function validateParams(params: GenerateVideoParams): void {
  // Prompt is required
  if (!params.prompt || typeof params.prompt !== 'string' || !params.prompt.trim()) {
    throw new Error('prompt is required and must be a non-empty string');
  }

  // Validate model
  if (params.model !== undefined && !isValidModel(params.model)) {
    throw new Error(
      `Invalid model '${params.model}'. Valid models: ${MODELS.join(', ')}`
    );
  }

  // Validate size
  if (params.size !== undefined && !isValidSize(params.size)) {
    throw new Error(
      `Invalid size '${params.size}'. Valid sizes: ${SIZES.join(', ')}`
    );
  }

  // Validate seconds
  if (params.seconds !== undefined) {
    const model = params.model || DEFAULT_MODEL;
    if (!isValidDuration(model, params.seconds)) {
      const validDurations = DURATIONS[model];
      throw new Error(
        `Invalid duration '${params.seconds}' for model '${model}'. Valid durations: ${validDurations.join(', ')} seconds`
      );
    }
  }
}

/**
 * Generate a video from text prompt or image
 */
export async function generateVideo(
  apiKey: string,
  params: GenerateVideoParams,
  options: GenerateVideoOptions = {}
): Promise<VideoGenerationResult> {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
    onProgress,
  } = options;

  try {
    // Normalize seconds to number (MCP may pass it as string)
    if (params.seconds !== undefined && typeof params.seconds === 'string') {
      params.seconds = parseInt(params.seconds, 10);
    }

    // Validate parameters
    validateParams(params);

    const model = params.model || DEFAULT_MODEL;
    const size = params.size || DEFAULT_SIZE;
    const seconds = typeof params.seconds === 'number' ? params.seconds : DEFAULT_SECONDS;

    debugLog('Generating video with params:', { model, size, seconds, hasImage: !!params.input_reference });

    // Prepare output path
    let outputPath: string | undefined;
    if (params.output_path) {
      outputPath = await normalizeAndValidatePath(params.output_path);
      outputPath = await generateUniqueFilePath(outputPath);
    }

    // Build request body
    // Note: OpenAI API expects 'seconds' as a string literal ("4", "8", "12"), not a number
    const requestBody: Record<string, unknown> = {
      prompt: params.prompt,
      model,
      size,
      seconds: String(seconds),
    };

    // Add input_reference for image-to-video
    if (params.input_reference) {
      requestBody.input_reference = params.input_reference;
    }

    // Make API request
    debugLog('Sending video generation request...');
    const response = await fetch(`${OPENAI_API_BASE}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

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
        throw new Error('Access denied. Sora 2 requires Tier 2+ API access ($10+ credit purchase).');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait and try again.');
      }

      throw new Error(errorMessage);
    }

    const result = (await response.json()) as SoraVideoResponse;
    const videoId = result.id;

    debugLog(`Video generation started: ${videoId}`);

    // Poll for completion
    const finalResult = await pollVideoResult(
      apiKey,
      videoId,
      pollInterval,
      maxPollAttempts,
      onProgress
    );

    debugLog('Video generation completed, downloading...');

    // Get the generation ID for download
    // API may return generations array or video_url directly
    const generationId = finalResult.generations?.[0]?.id;
    const downloadId = generationId || videoId;
    const videoDuration = finalResult.n_seconds || finalResult.duration || seconds;

    // Download and save video
    if (outputPath) {
      if (finalResult.video_url) {
        await downloadAndSaveVideo(finalResult.video_url, outputPath);
      } else {
        // Use content endpoint with the appropriate ID
        await downloadFromApiAndSave(apiKey, downloadId, outputPath);
      }

      return {
        success: true,
        video_id: videoId,
        video_url: finalResult.video_url,
        output_path: outputPath,
        duration: videoDuration,
      };
    }

    return {
      success: true,
      video_id: videoId,
      video_url: finalResult.video_url,
      duration: videoDuration,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    errorLog('Video generation failed', err);

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Format generation result for display
 */
export function formatGenerateResult(result: VideoGenerationResult): string {
  if (!result.success) {
    return `Video generation failed: ${result.error}`;
  }

  const lines: string[] = [];
  lines.push('Video generation completed successfully!');
  lines.push('');

  if (result.video_id) {
    lines.push(`Video ID: ${result.video_id}`);
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
