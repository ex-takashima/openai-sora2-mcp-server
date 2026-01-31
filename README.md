# OpenAI Sora 2 MCP Server

Model Context Protocol (MCP) server for video generation using OpenAI Sora 2 API.

## Features

- **Text-to-Video**: Generate videos from text prompts
- **Image-to-Video**: Animate images into videos
- **Remix**: Modify existing videos with new prompts
- **Batch Processing**: Execute multiple video generation jobs with concurrency control
- **Cost Estimation**: Estimate costs before executing batch jobs

## Requirements

- Node.js 18.0.0 or higher
- OpenAI API key with Tier 2+ access ($10+ credit purchase required for Sora)

## Installation

```bash
npm install openai-sora2-mcp-server
```

Or clone and build locally:

```bash
git clone https://github.com/your-repo/openai-sora2-mcp-server.git
cd openai-sora2-mcp-server
npm install
npm run build
```

## Configuration

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-...
DEBUG=false
OUTPUT_DIR=./output
VIDEO_POLL_INTERVAL=15000
VIDEO_MAX_POLL_ATTEMPTS=120
```

## Usage

### MCP Server

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sora2": {
      "command": "npx",
      "args": ["sora2-mcp-server"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Available Tools

#### generate_video

Generate a video from text prompt or image.

```
Parameters:
- prompt (required): Description of the video to generate
- model: "sora-2" (default) or "sora-2-pro"
- size: "1280x720" (default), "1920x1080", "1080x1920", etc.
- seconds: 4/8/12 for sora-2, 10/15/25 for sora-2-pro
- input_reference: Image URL or base64 for image-to-video
- output_path: Path to save the video file
```

#### remix_video

Remix an existing video with a new prompt.

```
Parameters:
- prompt (required): New description for the remixed video
- remix_video_id (required): ID of the video to remix
- output_path: Path to save the remixed video
```

#### get_video_status

Check the status of a video generation job.

```
Parameters:
- video_id (required): ID of the video to check
```

#### list_videos

List previously generated videos.

```
Parameters:
- limit: Maximum number of videos to return (default: 20)
```

### Batch CLI

Execute multiple video generation jobs from a configuration file:

```bash
sora2-batch config.json [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `--output-dir <path>` | Output directory for generated videos |
| `--format text\|json` | Output format (default: text) |
| `--timeout <ms>` | Total batch timeout in milliseconds |
| `--max-concurrent <n>` | Maximum concurrent jobs (1-5, default: 2) |
| `--poll-interval <ms>` | Polling interval (default: 15000) |
| `--estimate-only` | Only estimate cost without executing |
| `--help` | Show help |

#### Example

```bash
# Estimate cost
sora2-batch examples/batch-simple.json --estimate-only

# Execute batch
sora2-batch examples/batch-simple.json --output-dir ./output --max-concurrent 3
```

### Batch Configuration

```json
{
  "jobs": [
    {
      "prompt": "A cat playing piano in a jazz bar",
      "seconds": 8,
      "size": "1280x720"
    },
    {
      "prompt": "Ocean waves at sunset",
      "seconds": 4,
      "size": "1920x1080"
    }
  ],
  "output_dir": "./output",
  "max_concurrent": 2,
  "default_model": "sora-2",
  "default_size": "1280x720",
  "default_seconds": 4,
  "retry_policy": {
    "max_retries": 2,
    "retry_delay_ms": 1000,
    "retry_on_errors": ["rate_limit", "timeout", "429", "503"]
  }
}
```

## Models and Pricing

### sora-2 (Standard)

| Duration | Resolution | Price |
|----------|------------|-------|
| 4 sec | 720p | $0.40 |
| 8 sec | 720p | $0.80 |
| 12 sec | 720p | $1.20 |

### sora-2-pro (High Quality)

| Duration | Resolution | Price |
|----------|------------|-------|
| 10 sec | 720p | $3.00 |
| 15 sec | 720p | $4.50 |
| 25 sec | 720p | $7.50 |
| 10 sec | 1024p | $5.00 |
| 25 sec | 1024p | $12.50 |

## Supported Resolutions

| Aspect Ratio | Resolutions |
|--------------|-------------|
| 16:9 (Landscape) | 1920x1080, 1280x720 |
| 9:16 (Portrait) | 1080x1920, 720x1280 |
| 1:1 (Square) | 1080x1080, 480x480 |

## API Reference

### Endpoints

| Operation | Endpoint |
|-----------|----------|
| Generate Video | `POST https://api.openai.com/v1/videos` |
| Remix Video | `POST https://api.openai.com/v1/videos/{id}/remix` |
| Get Status | `GET https://api.openai.com/v1/videos/{id}` |
| List Videos | `GET https://api.openai.com/v1/videos` |
| Download | `GET https://api.openai.com/v1/videos/{id}/content` |

### Video Status

| Status | Description |
|--------|-------------|
| `queued` | Waiting in queue |
| `in_progress` | Currently processing |
| `completed` | Generation finished |
| `failed` | Generation failed |
| `cancelled` | Job was cancelled |

## License

MIT
