/**
 * Path handling utilities
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize and validate output path
 * - Handles relative paths (resolves against OUTPUT_DIR or cwd)
 * - Ensures parent directory exists
 */
export async function normalizeAndValidatePath(
  outputPath: string
): Promise<string> {
  let normalizedPath = outputPath;

  // Handle relative paths
  if (!path.isAbsolute(outputPath)) {
    const baseDir = process.env.OUTPUT_DIR || process.cwd();
    normalizedPath = path.join(baseDir, outputPath);
  }

  // Ensure directory exists
  const dir = path.dirname(normalizedPath);
  await fs.mkdir(dir, { recursive: true });

  return normalizedPath;
}

/**
 * Generate unique file path to avoid overwrites
 * Adds counter suffix: video.mp4 -> video_1.mp4 -> video_2.mp4
 */
export async function generateUniqueFilePath(
  filePath: string
): Promise<string> {
  if (!(await fileExists(filePath))) {
    return filePath;
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);

  let counter = 1;
  let uniquePath = path.join(dir, `${baseName}_${counter}${ext}`);

  while (await fileExists(uniquePath)) {
    counter++;
    uniquePath = path.join(dir, `${baseName}_${counter}${ext}`);
  }

  return uniquePath;
}

/**
 * Get display-friendly path (relative if possible)
 */
export function getDisplayPath(filePath: string): string {
  const cwd = process.cwd();
  if (filePath.startsWith(cwd)) {
    return path.relative(cwd, filePath);
  }
  return filePath;
}

/**
 * Get video extension from path, default to 'mp4'
 */
export function getVideoExtension(outputPath: string): string {
  const ext = path.extname(outputPath).toLowerCase();
  if (['.mp4', '.webm', '.mov'].includes(ext)) {
    return ext.substring(1);
  }
  return 'mp4';
}

/**
 * Ensure path has .mp4 extension
 */
export function ensureVideoExtension(outputPath: string): string {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.mp4') {
    return outputPath;
  }
  if (['.webm', '.mov'].includes(ext)) {
    return outputPath;
  }
  return outputPath + '.mp4';
}

/**
 * Generate default output path for a video
 */
export function generateDefaultOutputPath(
  prefix: string = 'sora_video'
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${timestamp}.mp4`;
}
