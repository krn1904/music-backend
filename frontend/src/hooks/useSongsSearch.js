import { useCallback, useEffect, useMemo, useState } from "react";

function mapSongItem(item) {
  return {
    id: `${item.Artist}-${item.SongTitle}`,
    title: item.SongTitle || "-",
    artist: item.Artist || "-",
    album: item.Album || "-",
    year: item.Year || "-",
    imageKey: item.image_url || "",
    image: item.image_signed_url || item.image_url || ""
  };
}

function hasAnyField(activeQuery) {
  if (!activeQuery) return false;
  return Boolean(
    String(activeQuery.title || "").trim() ||
      String(activeQuery.year || "").trim() ||
      String(activeQuery.artist || "").trim() ||
      String(activeQuery.album || "").trim()
  );
}

function buildSearchParams(activeQuery, limit, nextToken) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (nextToken) params.set("nextToken", nextToken);

  if (activeQuery?.title?.trim()) params.set("title", activeQuery.title.trim());
  if (activeQuery?.year?.trim()) params.set("year", activeQuery.year.trim());
  if (activeQuery?.artist?.trim()) params.set("artist", activeQuery.artist.trim());
  if (activeQuery?.album?.trim()) params.set("album", activeQuery.album.trim());

  return params;
}

// Picks the most efficient DynamoDB operation for the given field combination.
// Artist+Album only  → Query via LSI  (AlbumIndex)
// Year (±Artist)     → Query via GSI  (YearArtistIndex)
// Everything else    → Scan  (/songs/search)
function buildFetchUrl(apiBaseUrl, activeQuery, limit, nextToken) {
  const artist = String(activeQuery?.artist || "").trim();
  const album  = String(activeQuery?.album  || "").trim();
  const year   = String(activeQuery?.year   || "").trim();
  const title  = String(activeQuery?.title  || "").trim();

  if (artist && album && !year && !title) {
    const params = new URLSearchParams({ artist, album, limit: String(limit) });
    if (nextToken) params.set("nextToken", nextToken);
    return `${apiBaseUrl}/songs/by-album?${params}`;
  }

  if (year && !album && !title) {
    const params = new URLSearchParams({ year, limit: String(limit) });
    if (artist) params.set("artist", artist);
    if (nextToken) params.set("nextToken", nextToken);
    return `${apiBaseUrl}/songs/by-year?${params}`;
  }

  return `${apiBaseUrl}/songs/search?${buildSearchParams(activeQuery, limit, nextToken)}`;
}

export function useSongsSearch(apiBaseUrl, pageSize, activeQuery) {
  const [queryResults, setQueryResults] = useState([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [songsError, setSongsError] = useState("");
  // Same token-stack idea as useSongsPagination — search pagination is also cursor-based.
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);

  // Matches backend rule: at least one field — avoids calling /songs/search with an empty query.
  const enabled = useMemo(() => hasAnyField(activeQuery), [activeQuery]);

  const fetchSongsPage = useCallback(
    async (cursorToken, size) => {
      setIsLoadingSongs(true);
      setSongsError("");
      try {
        const url = buildFetchUrl(apiBaseUrl, activeQuery, size, cursorToken);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const payload = await response.json();
        const songs = (payload.items || []).map(mapSongItem);
        setQueryResults(songs);

        setNextCursor(
          payload.pagination?.nextToken || null
        );
      } catch (error) {
        setSongsError(error?.message || "Failed to load search results");
        setQueryResults([]);
        setNextCursor(null);
      } finally {
        setIsLoadingSongs(false);
      }
    },
    [apiBaseUrl, activeQuery]
  );

  useEffect(() => {
    if (!enabled) return;

    setCursorHistory([null]);
    setCurrentPageIndex(0);
    setNextCursor(null);

    fetchSongsPage(null, pageSize);
  }, [enabled, fetchSongsPage, pageSize]);

  const handleNextPage = useCallback(async () => {
    if (!nextCursor || isLoadingSongs) return;
    const updatedHistory = [...cursorHistory, nextCursor];
    setCursorHistory(updatedHistory);
    const newIndex = updatedHistory.length - 1;
    setCurrentPageIndex(newIndex);
    await fetchSongsPage(nextCursor, pageSize);
  }, [cursorHistory, fetchSongsPage, isLoadingSongs, nextCursor, pageSize]);

  const handlePreviousPage = useCallback(async () => {
    if (currentPageIndex === 0 || isLoadingSongs) return;
    const previousIndex = currentPageIndex - 1;
    setCurrentPageIndex(previousIndex);
    await fetchSongsPage(cursorHistory[previousIndex], pageSize);
  }, [currentPageIndex, cursorHistory, fetchSongsPage, isLoadingSongs, pageSize]);

  return useMemo(
    () => ({
      queryResults,
      isLoadingSongs,
      songsError,
      currentPageIndex,
      hasNextPage: Boolean(nextCursor),
      handleNextPage,
      handlePreviousPage
    }),
    [
      queryResults,
      isLoadingSongs,
      songsError,
      currentPageIndex,
      nextCursor,
      handleNextPage,
      handlePreviousPage
    ]
  );
}
