import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchTavily, WebSearchError } from './search';

afterEach(() => vi.unstubAllGlobals());

describe('Tavily web search', () => {
  it('sends a bounded search request and returns safe, limited results', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({ results: [
      { title: 'Result', url: 'https://example.com/article', content: 'Useful excerpt', published_date: '2026-11-12' },
      { title: 'Unsafe', url: 'http://example.com/', content: 'Do not return' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchTavily('latest news', 'test-key')).resolves.toEqual([
      { title: 'Result', url: 'https://example.com/article', content: 'Useful excerpt', publishedDate: '2026-11-12' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'latest news', search_depth: 'basic', max_results: 5, include_answer: false }),
    }));
  });

  it('fails safely for missing keys, invalid input, and exhausted plans', async () => {
    await expect(searchTavily('hello', undefined)).rejects.toThrow('TAVILY_API_KEY');
    await expect(searchTavily(' ', 'test-key')).rejects.toThrow(WebSearchError);
    const fetchMock = vi.fn(async () => new Response('private provider details', { status: 432 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchTavily('hello', 'test-key')).rejects.toThrow('quota or rate limit');
  });
});