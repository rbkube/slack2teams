import fs from 'fs';
import sharp from 'sharp';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { ReadableStream } from 'stream/web';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

export function isExpired(token) {
  const { exp } = parseJwt(token);
  return Date.now() >= exp * 1000;
}

export async function fetchWithRetry(
  url: string | URL | Request,
  init?: RequestInit,
  retries = 3,
  retryDelay = 2000
): Promise<Response> {
  // Perform the fetch request
  const response = await fetch(url, init);

  if (response.ok) {
    return response;
  } else {
    // Check if the 'Retry-After' header is present
    const retryAfter = response.headers.get('Retry-After');

    if (retryAfter) {
      // Calculate retry delay based on the 'Retry-After' header (in seconds)
      retryDelay = parseInt(retryAfter) * 1000;
    } else {
      // Calculate retry delay based on exponential backoff
      retryDelay *= 2;
    }

    // Check if retries are still available
    if (retries > 0) {
      console.log(`(${retries} left): Request failed. Retrying in ${retryDelay / 1000} seconds...`);

      // Wait for the specified delay before retrying
      await new Promise((resolve) => setTimeout(resolve, retryDelay));

      // Retry the fetch request
      return fetchWithRetry(url, init, retries - 1, retryDelay);
    } else {
      const json = await response.json();
      throw {
        url: response.url,
        status: response.status,
        method: init?.method,
        headers: init?.headers,
        payload: init?.body,
        response: json,
      };
    }
  }
}

export const downloadFile = async (url: string, filepath: string, headers: any = {}) => {
  const { body } = await fetchWithRetry(url, { headers });
  const filestream = fs.createWriteStream(filepath);
  await finished(Readable.fromWeb(body as ReadableStream<any>).pipe(filestream));
};

export const downloadFromSlackWithCookieToken = ({ slack_url, cookieToken, filepath }) => {
  return downloadFile(slack_url, filepath, {
    cookie: `d=${encodeURIComponent(cookieToken)}`,
  });
};

export async function generateThumbnailBase64(inputPath, maxHeight = 300) {
  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();

    const originalWidth = metadata.width;
    const originalHeight = metadata.height;

    let width, height;

    if (originalHeight > maxHeight) {
      height = maxHeight;
      width = Math.round((maxHeight / originalHeight) * originalWidth);
    } else {
      width = originalWidth;
      height = originalHeight;
    }

    const compressionOptions = {
      quality: 90, // Quality of the output image
      compressionLevel: 9, // Compression level, from 0 (no compression) to 9 (maximum compression)
      effort: 6, // Effort level for compression, from 1 (fastest) to 10 (slowest)
    };

    const resizedImageBuffer = await image.resize(width, height).png(compressionOptions).toBuffer();

    const base64String = resizedImageBuffer.toString('base64');
    return {
      width,
      height,
      size: resizedImageBuffer.length,
      url: `data:image/png;base64,${base64String}`,
    };
  } catch (error) {
    // console.error('Error generating thumbnail:', error);
    throw error;
  }
}

export function formatTime(ms) {
  const seconds = (ms / 1000).toFixed(2);
  const minutes = (ms / (1000 * 60)).toFixed(2);

  if (ms < 1000) {
    return `${ms} ms`;
  } else if (ms < 1000 * 60) {
    return `${seconds} seconds`;
  } else {
    return `${minutes} minutes`;
  }
}

export function scaleDimensions(originalWidth, originalHeight, maxHeight = 200) {
  if (originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  const aspectRatio = originalWidth / originalHeight;
  const scaledHeight = maxHeight;
  const scaledWidth = Math.round(maxHeight * aspectRatio);

  return { width: scaledWidth, height: scaledHeight };
}
