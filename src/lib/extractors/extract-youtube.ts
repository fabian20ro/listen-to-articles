/**
 * YouTube transcript and metadata extraction.
 *
 * Worker-only path. Browser callers should go through the worker `/parse` API.
 */

import { detectLanguage } from '../lang-detect.js';
import {
  type Article,
  UpstreamResponseError,
  WORDS_PER_MINUTE,
  YOUTUBE_TRANSCRIPT_PARAGRAPH_THRESHOLD,
} from './types.js';
import {
  buildArticleFromParagraphs,
  countWords,
} from './utils.js';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const ANDROID_USER_AGENT =
  'com.google.android.youtube/21.14.48 (Linux; U; Android 14; en_US)';

/** Constant API key for Android InnerTube client to bypass blocked watch page. */
const ANDROID_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

async function handleYoutubeResponse(response: Response, label: string): Promise<Response> {
  if (response.status === 429) {
    throw new UpstreamResponseError(429, `YouTube rate limit exceeded (upstream) when ${label}. The Worker IP may be blocked.`);
  }
  if (!response.ok) {
    throw new Error(`YouTube returned ${response.status} when ${label}.`);
  }
  return response;
}

type TranscriptSegment = {
  text: string;
  duration: number;
  offset: number;
  lang: string;
};

type TranscriptTrack = {
  baseUrl?: string;
  url?: string;
  languageCode?: string;
};

/**
 * Extract video ID from various YouTube URL formats.
 *
 * Supports: standard watch, short (youtu.be), embed, v, shorts, live URLs.
 * Handles query parameters (`v`, `list`), timestamp fragments (`#t=`),
 * and trailing slashes on youtu.be links. Returns null for invalid hosts
 * or malformed IDs (not 11 chars matching `[\\w-]{11}`).
 */
export function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).replace(/\/$/, '');
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) {
      return null;
    }
    if (
      parsed.pathname.startsWith('/watch')
      || parsed.pathname.startsWith('/embed/')
      || parsed.pathname.startsWith('/shorts/')
      || parsed.pathname.startsWith('/live/')
      || parsed.pathname.startsWith('/v/')
    ) {
      const id = parsed.pathname.startsWith('/watch')
        ? parsed.searchParams.get('v') || parsed.pathname.split('/')[2]
        : parsed.pathname.split('/')[2];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractArticleFromYoutube(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Article> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL.');
  }

  try {
    let playerJson: any;
    try {
      // Step 1: Attempt direct Player API call with static key (bypasses blocked watch page)
      playerJson = await fetchPlayerJson(videoId, ANDROID_API_KEY, fetcher);
    } catch (apiErr: unknown) {
      // Step 2: Fallback to watch page extraction if direct call fails
      const watchResponse = await fetchYoutubePage(videoId, fetcher);
      const html = await watchResponse.text();
      const apiKey = extractInnertubeApiKey(html);
      playerJson = await fetchPlayerJson(videoId, apiKey, fetcher);
    }

    const title = playerJson.videoDetails?.title || 'YouTube Video';
    
    // Prioritize full description from microformat (if available)
    const microDescription = playerJson.microformat?.playerMicroformatRenderer?.description;
    let description = '';
    if (typeof microDescription?.simpleText === 'string') {
      description = microDescription.simpleText;
    } else if (Array.isArray(microDescription?.runs)) {
      description = microDescription.runs.map((r: any) => r.text || '').join('');
    } else {
      description = playerJson.videoDetails?.shortDescription || '';
    }
    description = description.trim();

    const track = pickTranscriptTrack(playerJson);
    const transcriptItems = await fetchTranscriptSegments(track, fetcher);

    if (transcriptItems.length === 0) {
      throw new Error('No transcript found for this video. Captions may be disabled.');
    }

    const paragraphs = groupTranscriptIntoParagraphs(transcriptItems.map((item) => item.text));
    const articleTitle = `Transcript for: ${title}`;
    const textContent = paragraphs.join('\n\n');
    const markdownParts = [`# ${articleTitle}`];
    if (description) {
      markdownParts.push(`> ${description.replace(/\n/g, '\n> ')}`);
    }
    markdownParts.push(textContent);

    const article = buildArticleFromParagraphs(paragraphs, articleTitle, 'YouTube', markdownParts.join('\n\n'));
    article.lang = detectLanguage(textContent);
    article.excerpt = description.slice(0, 200) || textContent.slice(0, 200);
    article.wordCount = countWords(textContent);
    article.estimatedMinutes = Math.max(1, Math.round(article.wordCount / WORDS_PER_MINUTE));
    article.resolvedUrl = url;
    return article;
  } catch (err: unknown) {
    if (err instanceof UpstreamResponseError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`YouTube extraction failed: ${msg}`);
  }
}

async function fetchYoutubePage(videoId: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': DESKTOP_USER_AGENT,
      'Referer': 'https://www.youtube.com/',
    },
  });
  return handleYoutubeResponse(response, 'fetching video page');
}

function extractInnertubeApiKey(html: string): string {
  const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
    || html.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/);
  if (!match) {
    throw new Error('Could not find YouTube API key for transcript lookup.');
  }
  return match[1];
}

async function fetchPlayerJson(videoId: string, apiKey: string, fetcher: typeof fetch): Promise<any> {
  const response = await fetcher(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_USER_AGENT,
      'X-Goog-Api-Format-Version': '2',
      'Referer': 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '21.14.48',
          androidSdkVersion: 34,
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
    }),
  });

  await handleYoutubeResponse(response, 'fetching transcript metadata');

  return await response.json();
}

/** Picks the first transcript track from player JSON.
 *
 * Read order (matching production precedence):
 *   1. `playerJson.captions.playerCaptionsTracklistRenderer.captionTracks[0]`
 *   2. `playerJson.playerCaptionsTracklistRenderer.captionTracks[0]`
 *
 * Throws:
 *   - "Transcript metadata is not available" when the captions key is absent or
 *     its renderer does not exist (but playabilityStatus.status === 'OK' means a
 *     different error).
 *   - "No transcript found" when `captionTracks` exists but is empty.
 *
 * Track field precedence for fetch URL: `baseUrl`, then `url`, then failure.
 */
export function pickTranscriptTrack(playerJson: any): TranscriptTrack {
  const tracklist =
    playerJson?.captions?.playerCaptionsTracklistRenderer
    || playerJson?.playerCaptionsTracklistRenderer;
  const tracks = tracklist?.captionTracks;

  if (!playerJson?.captions || !tracklist) {
    if (playerJson?.playabilityStatus?.status === 'OK') {
      throw new Error('No transcript found for this video. Captions may be disabled.');
    }
    throw new Error('Transcript metadata is not available for this video.');
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('No transcript found for this video. Captions may be disabled.');
  }

  return tracks[0];
}

async function fetchTranscriptSegments(track: TranscriptTrack, fetcher: typeof fetch): Promise<TranscriptSegment[]> {
  const rawTranscriptUrl = track.baseUrl || track.url || '';
  if (!rawTranscriptUrl) {
    throw new Error('Transcript track is missing a fetch URL.');
  }

  const transcriptUrl = rawTranscriptUrl.replace(/&fmt=[^&]+/, '') + '&fmt=json3';
  const response = await fetcher(transcriptUrl, {
    headers: {
      'User-Agent': ANDROID_USER_AGENT,
      'Referer': 'https://www.youtube.com/',
    },
  });
  await handleYoutubeResponse(response, 'fetching transcript data');

  const data = await response.json() as any;
  const events = data.events || [];

  return events
    .filter((event: any) => event.segs)
    .map((event: any) => ({
      text: event.segs.map((seg: any) => seg.utf8).join(''),
      duration: (event.dDurationMs || 0) / 1000,
      offset: (event.tStartMs || 0) / 1000,
      lang: track.languageCode || 'en',
    }));
}

/** Group short transcript segments into readable paragraphs. */
function groupTranscriptIntoParagraphs(texts: string[]): string[] {
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (const text of texts) {
    const cleaned = text.trim();
    if (!cleaned) continue;

    if (
      currentParagraph
      && !currentParagraph.endsWith('.')
      && !currentParagraph.endsWith('?')
      && !currentParagraph.endsWith('!')
    ) {
      currentParagraph += ' ' + cleaned;
      continue;
    }

    if (currentParagraph.length > YOUTUBE_TRANSCRIPT_PARAGRAPH_THRESHOLD) {
      paragraphs.push(currentParagraph.trim());
      currentParagraph = cleaned;
      continue;
    }

    currentParagraph += (currentParagraph ? '\n\n' : '') + cleaned;
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs.map((paragraph) => paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim());
}
