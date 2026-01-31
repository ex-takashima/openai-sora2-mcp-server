#!/usr/bin/env node

/**
 * OpenAI Sora 2 MCP Server
 *
 * Model Context Protocol server for video generation using OpenAI Sora 2 API
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';

import { generateVideo, formatGenerateResult } from './tools/generate.js';
import { remixVideo, formatRemixResult } from './tools/remix.js';
import {
  MODELS,
  SIZES,
  DURATIONS,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  DEFAULT_SECONDS,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  type GenerateVideoParams,
  type RemixVideoParams,
  type GetVideoStatusParams,
  type ListVideosParams,
  type SoraVideoResponse,
} from './types/tools.js';
import { debugLog, errorLog } from './utils/debug.js';

// Load environment variables
dotenv.config();

/**
 * Normalize MCP parameters (convert string numbers to actual numbers)
 */
function normalizeParams<T>(params: T): T {
  if (typeof params !== 'object' || params === null) {
    return params;
  }

  const normalized = { ...params } as Record<string, unknown>;

  // Convert numeric string fields to numbers
  const numericFields = ['seconds', 'limit'];
  for (const field of numericFields) {
    if (field in normalized && typeof normalized[field] === 'string') {
      const parsed = parseInt(normalized[field] as string, 10);
      if (!isNaN(parsed)) {
        normalized[field] = parsed;
      }
    }
  }

  return normalized as T;
}

const OPENAI_API_BASE = 'https://api.openai.com/v1';

// Get API key
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Error: OPENAI_API_KEY environment variable is required.');
  console.error('Please set it in your .env file or environment.');
  process.exit(1);
}

// Get polling settings from environment
const pollInterval = process.env.VIDEO_POLL_INTERVAL
  ? parseInt(process.env.VIDEO_POLL_INTERVAL, 10)
  : DEFAULT_POLL_INTERVAL;
const maxPollAttempts = process.env.VIDEO_MAX_POLL_ATTEMPTS
  ? parseInt(process.env.VIDEO_MAX_POLL_ATTEMPTS, 10)
  : DEFAULT_MAX_POLL_ATTEMPTS;

// Tool definitions
const TOOLS = [
  {
    name: 'generate_video',
    description: `Generate a video from text prompt using OpenAI Sora 2.
Supports text-to-video and image-to-video generation.

Models:
- sora-2: Standard model. Durations: 4, 8, 12 seconds. $0.10/sec
- sora-2-pro: High quality model. Durations: 10, 15, 25 seconds. $0.30-0.50/sec

Resolutions: 1920x1080, 1280x720 (16:9), 1080x1920, 720x1280 (9:16), 1080x1080, 480x480 (1:1)

For image-to-video, provide input_reference with image URL or base64 data.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the video to generate. Include details about subject, camera, lighting, and motion.',
        },
        model: {
          type: 'string',
          enum: MODELS,
          description: `Model to use. Default: ${DEFAULT_MODEL}`,
        },
        size: {
          type: 'string',
          enum: SIZES,
          description: `Video resolution. Default: ${DEFAULT_SIZE}`,
        },
        seconds: {
          type: 'number',
          description: `Video duration in seconds. sora-2: 4/8/12, sora-2-pro: 10/15/25. Default: ${DEFAULT_SECONDS}`,
        },
        input_reference: {
          type: 'string',
          description: 'For image-to-video: URL or base64 encoded image. Image resolution should match output size.',
        },
        output_path: {
          type: 'string',
          description: 'Path to save the video file. If not specified, video URL is returned.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'remix_video',
    description: `Remix an existing video with a new prompt.
The remixed video will have the same basic structure as the original but with modifications based on the new prompt.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'New description for the remixed video. Describe what changes you want.',
        },
        remix_video_id: {
          type: 'string',
          description: 'ID of the video to remix. Must be a previously generated video.',
        },
        output_path: {
          type: 'string',
          description: 'Path to save the remixed video file.',
        },
      },
      required: ['prompt', 'remix_video_id'],
    },
  },
  {
    name: 'get_video_status',
    description: 'Get the status of a video generation job.',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: {
          type: 'string',
          description: 'ID of the video to check.',
        },
      },
      required: ['video_id'],
    },
  },
  {
    name: 'list_videos',
    description: 'List previously generated videos.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of videos to return. Default: 20',
        },
      },
    },
  },
];

// Create MCP server
const server = new Server(
  { name: 'openai-sora2-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog('Listing tools');
  return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  debugLog(`Tool called: ${name}`, args);

  try {
    switch (name) {
      case 'generate_video': {
        const rawParams = args as unknown as GenerateVideoParams;
        const params = normalizeParams(rawParams);
        const result = await generateVideo(apiKey, params, {
          pollInterval,
          maxPollAttempts,
        });

        return {
          content: [
            {
              type: 'text',
              text: formatGenerateResult(result),
            },
          ],
        };
      }

      case 'remix_video': {
        const params = args as unknown as RemixVideoParams;
        const result = await remixVideo(apiKey, params, pollInterval, maxPollAttempts);

        return {
          content: [
            {
              type: 'text',
              text: formatRemixResult(result),
            },
          ],
        };
      }

      case 'get_video_status': {
        const params = args as unknown as GetVideoStatusParams;

        if (!params.video_id) {
          throw new McpError(ErrorCode.InvalidParams, 'video_id is required');
        }

        const response = await fetch(`${OPENAI_API_BASE}/videos/${params.video_id}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new McpError(ErrorCode.InvalidParams, `Video not found: ${params.video_id}`);
          }
          const errorText = await response.text();
          throw new McpError(ErrorCode.InternalError, `API error: ${response.status} - ${errorText}`);
        }

        const result = (await response.json()) as SoraVideoResponse;

        const lines: string[] = [];
        lines.push(`Video ID: ${result.id}`);
        lines.push(`Status: ${result.status}`);
        if (result.duration) {
          lines.push(`Duration: ${result.duration} seconds`);
        }
        if (result.video_url) {
          lines.push(`URL: ${result.video_url}`);
        }
        if (result.error) {
          lines.push(`Error: ${result.error}`);
        }
        if (result.created_at) {
          lines.push(`Created: ${result.created_at}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
            },
          ],
        };
      }

      case 'list_videos': {
        const rawParams = args as unknown as ListVideosParams;
        const params = normalizeParams(rawParams);
        const limit = params.limit || 20;

        const response = await fetch(`${OPENAI_API_BASE}/videos?limit=${limit}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new McpError(ErrorCode.InternalError, `API error: ${response.status} - ${errorText}`);
        }

        const result = (await response.json()) as { data: SoraVideoResponse[] };
        const videos = result.data || [];

        if (videos.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No videos found.',
              },
            ],
          };
        }

        const lines: string[] = [];
        lines.push(`Found ${videos.length} video(s):`);
        lines.push('');

        for (const video of videos) {
          lines.push(`- ID: ${video.id}`);
          lines.push(`  Status: ${video.status}`);
          if (video.duration) {
            lines.push(`  Duration: ${video.duration}s`);
          }
          if (video.created_at) {
            lines.push(`  Created: ${video.created_at}`);
          }
          lines.push('');
        }

        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    errorLog(`Tool ${name} failed`, err);

    throw new McpError(ErrorCode.InternalError, err.message);
  }
});

// Start server
async function main() {
  debugLog('Starting OpenAI Sora 2 MCP Server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  debugLog('Server connected and ready');
}

main().catch((error) => {
  errorLog('Server failed to start', error);
  process.exit(1);
});
