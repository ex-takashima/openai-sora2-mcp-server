/**
 * Test script for image-to-video generation
 */

import { generateVideo, formatGenerateResult } from '../dist/tools/generate.js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Error: OPENAI_API_KEY is required');
  process.exit(1);
}

async function main() {
  console.log('Starting image-to-video generation test...\n');

  const imagePath = path.join(__dirname, 'don.png');
  const outputPath = path.join(__dirname, 'output', 'don-video.mp4');

  console.log(`Input image: ${imagePath}`);
  console.log(`Output path: ${outputPath}`);
  console.log('');

  const result = await generateVideo(apiKey, {
    prompt: 'The anime girl waves her hand gently and smiles at the camera, her hair swaying slightly in a soft breeze. Soft ambient lighting.',
    input_reference: imagePath,
    model: 'sora-2',
    size: '1280x720',  // 16:9 landscape
    seconds: 4,
    output_path: outputPath,
  }, {
    onProgress: (status, attempt, maxAttempts) => {
      console.log(`[${attempt}/${maxAttempts}] Status: ${status}`);
    },
  });

  console.log('\n' + formatGenerateResult(result));
}

main().catch(console.error);
