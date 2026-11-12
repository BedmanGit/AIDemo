export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
};

export class WebSearchError extends Error {}

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 700;

export async function searchTavily(query: unknown, apiKey: string | undefined, signal?: AbortSignal): Promise<WebSearchResult[]> {
  if (!apiKey || apiKey === 'your_tavily_api_key') {
    throw new WebSearchError('Web search is not configured. Add TAVILY_API_KEY to .env and restart the server.');
  }
  if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_LENGTH) {
    throw new WebSearchError('The search query is invalid or too long.');
  }

  let response: Response;
  try {
    response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), search_depth: 'basic', max_results: MAX_RESULTS, include_answer: false }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WebSearchError('The web search provider could not be reached. Try again shortly.');
  }

  if (response.status === 401) throw new WebSearchError('The web search API key was rejected. Check TAVILY_API_KEY.');
  if (response.status === 429 || response.status === 432 || response.status === 433) {
    throw new WebSearchError('The web search provider quota or rate limit was reached. Check Tavily usage and plan limits.');
  }
  if (!response.ok) throw new WebSearchError('The web search provider returned an error. Try again shortly.');

  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
      throw new Error();
    }
    return (payload as { results: unknown[] }).results.slice(0, MAX_RESULTS).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const result = item as Record<string, unknown>;
      if (typeof result.title !== 'string' || typeof result.url !== 'string' || typeof result.content !== 'string') return [];
      try {
        const url = new URL(result.url);
        if (url.protocol !== 'https:') return [];
        return [{
          title: result.title.slice(0, 200),
          url: url.toString(),
          content: result.content.slice(0, MAX_CONTENT_LENGTH),
          ...(typeof result.published_date === 'string' ? { publishedDate: result.published_date.slice(0, 80) } : {}),
        }];
      } catch {
        return [];
      }
    });
  } catch {
    throw new WebSearchError('The web search provider returned an invalid response.');
  }
}