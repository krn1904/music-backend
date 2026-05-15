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

export function useSongsPagination(apiBaseUrl, pageSize) {
  const [queryResults, setQueryResults] = useState([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [songsError, setSongsError] = useState("");
  // Index i holds the nextToken used to fetch page i (null for first page) so "previous" can re-fetch with the right cursor.
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);

  const fetchSongsPage = useCallback(
    async (cursorToken, size) => {
      setIsLoadingSongs(true);
      setSongsError("");
      try {
        const params = new URLSearchParams({ limit: String(size) });
        if (cursorToken) {
          params.append("nextToken", cursorToken);
        }

        const response = await fetch(`${apiBaseUrl}/songs?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const payload = await response.json();
        const songs = (payload.items || []).map(mapSongItem);
        setQueryResults(songs);
        setNextCursor(payload.pagination?.nextToken || null);
      } catch (error) {
        setSongsError(error.message || "Failed to load songs");
        setQueryResults([]);
        setNextCursor(null);
      } finally {
        setIsLoadingSongs(false);
      }
    },
    [apiBaseUrl]
  );

  useEffect(() => {
    setCursorHistory([null]);
    setCurrentPageIndex(0);
    fetchSongsPage(null, pageSize);
  }, [fetchSongsPage, pageSize]);

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
      currentPageIndex,
      handleNextPage,
      handlePreviousPage,
      isLoadingSongs,
      nextCursor,
      queryResults,
      songsError
    ]
  );
}
