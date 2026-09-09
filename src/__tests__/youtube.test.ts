import { describe, it, expect, vi } from 'vitest';
import { extractArticleFromYoutube, extractYoutubeVideoId, pickTranscriptTrack } from '../lib/extractors/extract-youtube.js';

const ANDROID_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

describe('pickTranscriptTrack', () => {
  const nestedTrack = { baseUrl: 'https://example.com/nested' };
  const fallbackTrack = { baseUrl: 'https://example.com/fallback' };

  it('uses the top-level renderer when captions is absent', () => {
    expect(pickTranscriptTrack({
      playerCaptionsTracklistRenderer: { captionTracks: [fallbackTrack] },
      playabilityStatus: { status: 'OK' },
    })).toBe(fallbackTrack);
  });

  it('prefers the nested renderer when both renderers exist', () => {
    expect(pickTranscriptTrack({
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [nestedTrack] } },
      playerCaptionsTracklistRenderer: { captionTracks: [fallbackTrack] },
    })).toBe(nestedTrack);
  });

  it('does not bypass an empty nested renderer using top-level tracks', () => {
    expect(() => pickTranscriptTrack({
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
      playerCaptionsTracklistRenderer: { captionTracks: [fallbackTrack] },
    })).toThrow('No transcript found for this video. Captions may be disabled.');
  });

  it.each([
    ['OK', 'No transcript found for this video. Captions may be disabled.'],
    ['ERROR', 'Transcript metadata is not available for this video.'],
    [undefined, 'Transcript metadata is not available for this video.'],
  ])('preserves missing-renderer errors for playability %s', (status, message) => {
    expect(() => pickTranscriptTrack({ playabilityStatus: { status } })).toThrow(message);
  });
});

describe('extractYoutubeVideoId', () => {
  it('extracts ID from standard watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from short URL', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from embed URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from v URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from shorts URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from live URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from unusual but valid subdomains', () => {
    expect(extractYoutubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles underscores in ID', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc_123-def')).toBe('abc_123-def');
  });

  it('returns null for IDs with invalid length', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc123')).toBeNull();
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc123456789012345')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(extractYoutubeVideoId('https://example.com')).toBeNull();
  });

  it('extracts ID from watch URL with timestamp param', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from watch URL with playlist param', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from short URL with extra params', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc123')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from embed URL with query params', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from shorts URL with timestamp fragment', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ#t=10')).toBe('dQw4w9WgXcQ');
  });
});

describe('extractArticleFromYoutube', () => {
  const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('fetches metadata directly via Player API with static key', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          videoDetails: {
            title: "Test Video",
            shortDescription: "Line one\nLine two"
          },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en',
                  languageCode: 'en',
                },
              ],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('https://www.youtube.com/api/timedtext')) {
        return new Response(JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello world.' }] },
            { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'This is a test transcript.' }] }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);

    // Should only be called 2 times: Player API + Transcript Data
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(article.title).toBe('Transcript for: Test Video');
    expect(article.siteName).toBe('YouTube');
    expect(article.markdown).toContain('Line one');
    expect(article.paragraphs.join(' ')).toContain('Hello world.');
    expect(article.resolvedUrl).toBe(YT_URL);
  });

  it('falls back to watch page extraction if direct API call fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      // Fail the direct API call
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response('Blocked', { status: 429 });
      }

      // Fallback 1: Watch page
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response('<html>"INNERTUBE_API_KEY":"abc123"</html>', { status: 200 });
      }

      // Fallback 2: Player API with extracted key
      if (url.startsWith('https://www.youtube.com/youtubei/v1/player?key=abc123')) {
        return new Response(JSON.stringify({
          videoDetails: { title: "Fallback Video" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }

      // Fallback 3: Transcript
      return new Response(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Fallback works.' }] }]
      }), { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);

    // 4 calls: Failed Direct API + Watch Page + Success Player API + Transcript
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(article.title).toBe('Transcript for: Fallback Video');
    expect(article.paragraphs[0]).toBe('Fallback works.');
  });

  it('extracts full description from microformat.simpleText', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: "Test", shortDescription: "short" },
          microformat: {
            playerMicroformatRenderer: {
              description: { simpleText: "Full long description from microformat" }
            }
          },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello.' }] }]
      }), { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.markdown).toContain('Full long description from microformat');
    expect(article.excerpt).toBe('Full long description from microformat'.slice(0, 200));
  });

  it('extracts full description from microformat.runs', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: "Test" },
          microformat: {
            playerMicroformatRenderer: {
              description: { runs: [{ text: "Part 1 " }, { text: "Part 2" }] }
            }
          },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello.' }] }]
      }), { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.markdown).toContain('Part 1 Part 2');
  });

  it('defaults to "YouTube Video" when player title is missing', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello world.' }] }]
      }), { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.title).toBe('Transcript for: YouTube Video');
  });

  it('throws if YouTube API key is not found in the watch page HTML', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response('blocked', { status: 500 });
      }
      // Return HTML without the API key
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response('<html><body>No key here</body></html>', { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch))
      .rejects.toThrow(/YouTube extraction failed:.*Could not find YouTube API key/);
  });

  it('throws before fetching when a transcript track is missing its URL', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: 'Missing URL Video' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ languageCode: 'en' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch))
      .rejects.toThrow(/Transcript track is missing a fetch URL/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throws when captions key is entirely missing but video plays', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: 'No Captions Video' },
          playabilityStatus: { status: 'OK' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch))
      .rejects.toThrow(/YouTube extraction failed/);
  });

  it('throws when captionTracks array is empty', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: 'Empty Tracks Video' },
          captions: {
            playerCaptionsTracklistRenderer: { captionTracks: [] },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch))
      .rejects.toThrow(/No transcript found/);
  });

  it('wraps transcript fetch failure in extraction error', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: 'Bad Transcript Video' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('https://www.youtube.com/api/timedtext')) {
        return new Response('Service unavailable', { status: 503 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch))
      .rejects.toThrow(/YouTube extraction failed/);
  });

  it('extracts API key from escaped JSON format in watch page', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response('blocked', { status: 500 });
      }
      // Return HTML where INNERTUBE_API_KEY is escaped with literal backslash-quote chars.
      const html = '<html>INNERTUBE_API_KEY\\":\\"escaped-key-12345\\"</html>';
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response(html, { status: 200 });
      }
      // Player API with extracted key
      if (url.startsWith('https://www.youtube.com/youtubei/v1/player?key=escaped-key-12345')) {
        return new Response(JSON.stringify({
          videoDetails: { title: "Escaped Key Video" },
          captions: {
            playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext' }] },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }
      // Transcript
      return new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Escaped works.' }] }] }), { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.title).toBe('Transcript for: Escaped Key Video');
    expect(article.paragraphs[0]).toBe('Escaped works.');
  });

  it('falls back to watch page when direct API returns non-JSON response', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      // Fail the direct API call with non-JSON body
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response('Internal Server Error', { status: 500 });
      }

      // Fallback: Watch page with valid key
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response('<html>\"INNERTUBE_API_KEY\":\"fallback-key-xyz\"</html>', { status: 200 });
      }

      // Player API with extracted fallback key
      if (url.startsWith('https://www.youtube.com/youtubei/v1/player?key=fallback-key-xyz')) {
        return new Response(JSON.stringify({
          videoDetails: { title: 'Fallback JSON Video' },
          captions: {
            playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext' }] },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }

      // Transcript
      return new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Fallback JSON works.' }] }] }), { status: 200 });
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.title).toBe('Transcript for: Fallback JSON Video');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('throws when both direct API and watch page extraction fail', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      // Fail the direct API call
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response('Blocked', { status: 403 });
      }

      // Watch page also fails
      if (url.startsWith('https://www.youtube.com/watch?v=')) {
        return new Response('<html>no key</html>', { status: 500 });
      }

      throw new Error(`Unexpected URL ${input}`);
    });

    await expect(extractArticleFromYoutube(YT_URL, fetcher as typeof fetch))
      .rejects.toThrow(/YouTube extraction failed/);
  });

  it('uses url field on caption track when baseUrl is absent', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_API_KEY}`)) {
        return new Response(JSON.stringify({
          videoDetails: { title: 'Url Field Video' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ languageCode: 'en', url: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en' }],
            },
          },
          playabilityStatus: { status: 'OK' },
        }), { status: 200 });
      }

      if (url.startsWith('https://www.youtube.com/api/timedtext')) {
        return new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Url field path works.' }] }] }), { status: 200 });
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const article = await extractArticleFromYoutube(YT_URL, fetcher as typeof fetch);
    expect(article.paragraphs[0]).toBe('Url field path works.');
  });
});
