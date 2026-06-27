/**
 * Jikan API v4 Wrapper
 * Handles rate-limiting (3 requests per second limit) and caching (24-hour expiration)
 */

const BASE_URL = 'https://api.jikan.moe/v4';
const CACHE_PREFIX = 'jikan_cache_';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Rate limit queue pointer
let lastRequestPromise = Promise.resolve();
const MIN_DELAY = 350; // Minimum delay between requests to keep under 3 requests/sec

/**
 * Throttled fetch implementation that queues requests to satisfy rate limiting.
 */
async function queuedFetch(url) {
  const currentPromise = lastRequestPromise.then(async () => {
    // Wait for the minimum required delay
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY));
    
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited: wait 2 seconds and retry once
        console.warn('Jikan API rate limit hit (429). Retrying after delay...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        const retryResponse = await fetch(url);
        if (!retryResponse.ok) {
          throw new Error(`HTTP error after retry! Status: ${retryResponse.status}`);
        }
        return retryResponse;
      }
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response;
  });

  // Chain catches so a failed request doesn't block subsequent requests in the queue
  lastRequestPromise = currentPromise.catch(err => {
    console.error('Queue request failed:', err);
  });

  return currentPromise;
}

/**
 * Retrieve an item from localStorage cache if it exists and hasn't expired.
 */
function getCachedData(key) {
  try {
    const entry = localStorage.getItem(CACHE_PREFIX + key);
    if (!entry) return null;

    const { timestamp, data } = JSON.parse(entry);
    if (Date.now() - timestamp < CACHE_DURATION) {
      return data;
    }
    // Expired item, clean up
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch (e) {
    console.error('Cache read error:', e);
  }
  return null;
}

/**
 * Cache data in localStorage with a timestamp.
 */
function setCachedData(key, data) {
  try {
    const entry = {
      timestamp: Date.now(),
      data: data
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    console.error('Cache write error:', e);
  }
}

/**
 * Main API wrapper object.
 */
const JikanAPI = {
  /**
   * Fetch top anime using various filters
   * @param {string} filter - 'airing', 'upcoming', 'bypopularity', 'favorite'
   * @param {string} type - 'tv', 'movie', 'ova', 'special', 'ona', 'music'
   * @param {number} limit - number of items to return (default 8)
   */
  async getTopAnime(filter = '', type = '', limit = 8) {
    const cacheKey = `top_${filter}_${type}_${limit}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;

    let url = `${BASE_URL}/top/anime?limit=${limit}`;
    if (filter) url += `&filter=${filter}`;
    if (type) url += `&type=${type}`;

    try {
      const response = await queuedFetch(url);
      const result = await response.json();
      if (result.data) {
        setCachedData(cacheKey, result.data);
        return result.data;
      }
      return [];
    } catch (e) {
      console.error('Error fetching top anime:', e);
      return [];
    }
  },

  /**
   * Fetch anime by specific genre
   * @param {number} genreId - Jikan Genre ID (e.g. 4 for Comedy)
   * @param {number} limit - default 8
   */
  async getAnimeByGenre(genreId, limit = 8) {
    const cacheKey = `genre_${genreId}_${limit}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;

    const url = `${BASE_URL}/anime?genres=${genreId}&order_by=popularity&sort=asc&limit=${limit}`;
    try {
      const response = await queuedFetch(url);
      const result = await response.json();
      if (result.data) {
        setCachedData(cacheKey, result.data);
        return result.data;
      }
      return [];
    } catch (e) {
      console.error(`Error fetching genre ${genreId}:`, e);
      return [];
    }
  },

  /**
   * Search anime by query text
   * @param {string} query - text search term
   * @param {number} limit - default 12
   */
  async searchAnime(query, limit = 12) {
    if (!query || query.trim().length === 0) return [];
    
    const cacheKey = `search_${query.trim().toLowerCase()}_${limit}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;

    const url = `${BASE_URL}/anime?q=${encodeURIComponent(query)}&limit=${limit}`;
    try {
      const response = await queuedFetch(url);
      const result = await response.json();
      if (result.data) {
        setCachedData(cacheKey, result.data);
        return result.data;
      }
      return [];
    } catch (e) {
      console.error(`Error searching anime for "${query}":`, e);
      return [];
    }
  },

  /**
   * Fetch full details for a single anime
   * @param {number|string} id - Mal ID
   */
  async getAnimeDetails(id) {
    if (!id) return null;

    const cacheKey = `details_${id}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;

    const url = `${BASE_URL}/anime/${id}/full`;
    try {
      const response = await queuedFetch(url);
      const result = await response.json();
      if (result.data) {
        setCachedData(cacheKey, result.data);
        return result.data;
      }
      return null;
    } catch (e) {
      console.error(`Error fetching anime details for ID ${id}:`, e);
      return null;
    }
  },

  /**
   * Fetch episodes list for an anime (paginated)
   * @param {number|string} id - Mal ID
   * @param {number} page - page number (each page is up to 100 episodes)
   */
  async getAnimeEpisodes(id, page = 1) {
    if (!id) return [];

    const cacheKey = `episodes_${id}_${page}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;

    const url = `${BASE_URL}/anime/${id}/episodes?page=${page}`;
    try {
      const response = await queuedFetch(url);
      const result = await response.json();
      if (result.data) {
        // Cache mapping: data + pagination info
        const resultPayload = {
          episodes: result.data,
          pagination: result.pagination || { has_next_page: false }
        };
        setCachedData(cacheKey, resultPayload);
        return resultPayload;
      }
      return { episodes: [], pagination: { has_next_page: false } };
    } catch (e) {
      console.error(`Error fetching episodes for anime ID ${id}:`, e);
      return { episodes: [], pagination: { has_next_page: false } };
    }
  }
};

// Export to window object for browser usage since we are not in a module bundle environment
window.JikanAPI = JikanAPI;
