/**
 * Video generation tool implementation
 */

import * as fs from 'fs';
import * as path from 'path';
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
 * Supported image MIME types for input_reference
 */
const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_TYPES[ext] || 'image/jpeg';
}

/**
 * Check if a string is a URL
 */
function isUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

/**
 * Check if a string is base64 data URI
 */
function isBase64DataUri(str: string): boolean {
  return str.startsWith('data:image/');
}

/**
 * Download image from URL and return as Buffer with MIME type
 */
async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  debugLog('Downloading image from URL:', url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());

  // Extract filename from URL or generate one
  const urlPath = new URL(url).pathname;
  const filename = path.basename(urlPath) || 'image.jpg';

  return { buffer, mimeType: contentType, filename };
}

/**
 * Parse base64 data URI and return as Buffer with MIME type
 */
function parseBase64DataUri(dataUri: string): { buffer: Buffer; mimeType: string; filename: string } {
  const matches = dataUri.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid base64 data URI format');
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');

  // Generate filename based on MIME type
  const ext = mimeType.split('/')[1] || 'jpg';
  const filename = `image.${ext}`;

  return { buffer, mimeType, filename };
}

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

    let response: Response;

    // Use multipart/form-data for image-to-video, JSON for text-to-video
    if (params.input_reference) {
      // Image-to-video: use multipart/form-data
      debugLog('Using multipart/form-data for image-to-video...');

      const formData = new FormData();
      formData.append('prompt', params.prompt);
      formData.append('model', model);
      formData.append('size', size);
      formData.append('seconds', String(seconds));

      // Process input_reference based on its type
      let imageBuffer: Buffer;
      let imageMimeType: string;
      let imageFilename: string;

      if (isUrl(params.input_reference)) {
        // Download image from URL
        const downloaded = await downloadImage(params.input_reference);
        imageBuffer = downloaded.buffer;
        imageMimeType = downloaded.mimeType;
        imageFilename = downloaded.filename;
      } else if (isBase64DataUri(params.input_reference)) {
        // Parse base64 data URI
        const parsed = parseBase64DataUri(params.input_reference);
        imageBuffer = parsed.buffer;
        imageMimeType = parsed.mimeType;
        imageFilename = parsed.filename;
      } else {
        // Assume it's a local file path
        const filePath = params.input_reference;
        if (!fs.existsSync(filePath)) {
          throw new Error(`Image file not found: ${filePath}`);
        }
        imageBuffer = fs.readFileSync(filePath);
        imageMimeType = getMimeType(filePath);
        imageFilename = path.basename(filePath);
      }

      // Create Blob and append to FormData
      // Convert Buffer to ArrayBuffer for Blob compatibility
      const arrayBuffer = imageBuffer.buffer.slice(
        imageBuffer.byteOffset,
        imageBuffer.byteOffset + imageBuffer.byteLength
      ) as ArrayBuffer;
      const imageBlob = new Blob([arrayBuffer], { type: imageMimeType });
      formData.append('input_reference', imageBlob, imageFilename);

      debugLog(`Uploading image: ${imageFilename} (${imageMimeType}, ${imageBuffer.length} bytes)`);

      // Make API request with FormData
      response = await fetch(`${OPENAI_API_BASE}/videos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // Note: Don't set Content-Type header, fetch will set it automatically with boundary
        },
        body: formData,
      });
    } else {
      // Text-to-video: use JSON
      debugLog('Using JSON for text-to-video...');

      const requestBody = {
        prompt: params.prompt,
        model,
        size,
        seconds: String(seconds),
      };

      response = await fetch(`${OPENAI_API_BASE}/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    }

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
