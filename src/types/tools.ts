/**
 * OpenAI Sora 2 API Types
 */

// Available models
export const MODELS = ['sora-2', 'sora-2-pro'] as const;
export type Model = (typeof MODELS)[number];

// Video durations per model (in seconds)
export const DURATIONS = {
  'sora-2': [4, 8, 12] as const,
  'sora-2-pro': [10, 15, 25] as const,
} as const;

export type Sora2Duration = (typeof DURATIONS)['sora-2'][number];
export type Sora2ProDuration = (typeof DURATIONS)['sora-2-pro'][number];
export type Duration = Sora2Duration | Sora2ProDuration;

// Supported resolutions
export const SIZES = [
  '1920x1080',
  '1280x720', // 16:9
  '1080x1920',
  '720x1280', // 9:16
  '1080x1080',
  '480x480', // 1:1
] as const;
export type Size = (typeof SIZES)[number];

// Video status
export const VIDEO_STATUSES = [
  'queued',
  'in_progress',
  'running',
  'preprocessing',
  'processing',
  'completed',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

// Defaults
export const DEFAULT_MODEL: Model = 'sora-2';
export const DEFAULT_SIZE: Size = '1280x720';
export const DEFAULT_SECONDS = 4;
export const DEFAULT_POLL_INTERVAL = 15000; // 15 seconds (recommended for Sora 2)
export const DEFAULT_MAX_POLL_ATTEMPTS = 120; // ~30 minutes with 15s interval

// Pricing (per second)
export const PRICING = {
  'sora-2': {
    '720p': 0.1,
    default: 0.1,
  },
  'sora-2-pro': {
    '720p': 0.3,
    '1024p': 0.5,
    default: 0.3,
  },
} as const;

/**
 * Parameters for generate_video tool
 * Note: MCP may pass numeric values as strings, so we accept both
 */
export interface GenerateVideoParams {
  prompt: string;
  model?: Model;
  size?: Size;
  seconds?: number | string;
  input_reference?: string; // Image-to-Video: local file path, URL, or base64 data URI (jpeg/png/webp)
  output_path?: string;
}

/**
 * Parameters for remix_video tool
 */
export interface RemixVideoParams {
  prompt: string;
  remix_video_id: string;
  output_path?: string;
}

/**
 * Parameters for get_video_status tool
 */
export interface GetVideoStatusParams {
  video_id: string;
}

/**
 * Parameters for list_videos tool
 */
export interface ListVideosParams {
  limit?: number;
}

/**
 * OpenAI Sora API request body for video generation
 */
export interface SoraVideoGenerationRequest {
  prompt: string;
  model?: string;
  size?: string;
  seconds?: number;
  input_reference?: string;
}

/**
 * Video generation item in generations array
 */
export interface SoraVideoGeneration {
  id: string;
}

/**
 * OpenAI Sora API response for video generation
 */
export interface SoraVideoResponse {
  id: string;
  object?: string;
  status: VideoStatus;
  video_url?: string;
  duration?: number;
  error?: string;
  failure_reason?: string;
  created_at?: string | number;
  finished_at?: string | number | null;
  generations?: SoraVideoGeneration[];
  n_seconds?: number;
}

/**
 * Result returned from video generation
 */
export interface VideoGenerationResult {
  success: boolean;
  video_id?: string;
  video_url?: string;
  output_path?: string;
  duration?: number;
  error?: string;
}

/**
 * Validation helpers
 */
export function isValidModel(model: string): model is Model {
  return MODELS.includes(model as Model);
}

export function isValidSize(size: string): size is Size {
  return SIZES.includes(size as Size);
}

export function isValidDuration(model: Model, seconds: number | string): boolean {
  const allowedDurations = DURATIONS[model];
  const numSeconds = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;
  return allowedDurations.includes(numSeconds as never);
}

export function getValidDurations(model: Model): readonly number[] {
  return DURATIONS[model];
}

export function getDefaultDuration(model: Model): number {
  return DURATIONS[model][0];
}

/**
 * Calculate cost for a video generation
 */
export function calculateCost(
  model: Model,
  seconds: number,
  size: Size
): number {
  const pricing = PRICING[model];
  const is720p = size.includes('720') || size.includes('480');
  const pricePerSecond = is720p ? pricing['720p'] : (pricing as Record<string, number>)['1024p'] || pricing.default;
  return pricePerSecond * seconds;
}
