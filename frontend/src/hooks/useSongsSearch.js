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

export function useSongsSearch(apiBaseUrl, pageSize, activeQuery) {
  const [queryResults, setQueryResults] = useState([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [songsError, setSongsError] = useState("");
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);

  const [totalSongs, setTotalSongs] = useState(null);
  const [totalPages, setTotalPages] = useState(null);
  const [isTotalApproximate, setIsTotalApproximate] = useState(false);

  const enabled = useMemo(() => hasAnyField(activeQuery), [activeQuery]);

  const fetchSongsPage = useCallback(
    async (cursorToken, size) => {
      setIsLoadingSongs(true);
      setSongsError("");
      try {
        const params = buildSearchParams(activeQuery || {}, size, cursorToken);
        const response = await fetch(`${apiBaseUrl}/songs/search?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const payload = await response.json();
        const songs = (payload.items || []).map(mapSongItem);
        setQueryResults(songs);
        setNextCursor(payload.pagination?.nextToken || null);
        setTotalSongs(
          Number.isFinite(payload.pagination?.totalSongs) ? payload.pagination.totalSongs : null
        );
        setTotalPages(
          Number.isFinite(payload.pagination?.totalPages) ? payload.pagination.totalPages : null
        );
        setIsTotalApproximate(Boolean(payload.pagination?.isTotalApproximate));
      } catch (error) {
        setSongsError(error?.message || "Failed to load search results");
        setQueryResults([]);
        setNextCursor(null);
        setTotalSongs(null);
        setTotalPages(null);
        setIsTotalApproximate(false);
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
    setTotalSongs(null);
    setTotalPages(null);
    setIsTotalApproximate(false);

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
      totalSongs,
      totalPages,
      isTotalApproximate,
      handleNextPage,
      handlePreviousPage
    }),
    [
      queryResults,
      isLoadingSongs,
      songsError,
      currentPageIndex,
      nextCursor,
      totalSongs,
      totalPages,
      isTotalApproximate,
      handleNextPage,
      handlePreviousPage
    ]
  );
}

