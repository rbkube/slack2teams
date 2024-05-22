import fs from 'fs';
import { method } from 'lodash';
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

// Function to perform a fetch request with retry logic for a 429 response
export function fetchWithRetry(
  url: string | URL | Request,
  init?: RequestInit,
  retries = 3,
  retryDelay = 2000
) {
  // Perform the fetch request
  return fetch(url, init).then((response) => {
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
        const counter = 3 - retries;
        console.log(
          `(Attempt ${counter}/3): Request failed. Retrying in ${retryDelay / 1000} seconds...`
        );
        // Set a timeout to retry after the specified delay
        setTimeout(() => fetchWithRetry(url, init, retries - 1, retryDelay), retryDelay);
      } else {
        return response.json().then((json) => {
          throw {
            url: response.url,
            status: response.status,
            method: init?.method,
            headers: init?.headers,
            payload: init?.body,
            response: json,
          };
        });
      }
    }
  });
}

export const downloadFile = async (url: string, filepath: string, headers: any = {}) => {
  const { body } = await fetch(url, { headers });
  const filestream = fs.createWriteStream(filepath);
  await finished(Readable.fromWeb(body as ReadableStream<any>).pipe(filestream));
};

export const downloadFromSlackWithCookieToken = ({ slack_url, cookieToken, filepath }) => {
  return downloadFile(slack_url, filepath, {
    cookie: `d=${encodeURIComponent(cookieToken)}`,
  });
};
