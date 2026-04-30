import React, { useCallback, useEffect, useMemo, useState } from "react";
import LibraryCard from "./components/LibraryCard";
import PaginationControls from "./components/PaginationControls";
import ResultCard from "./components/ResultCard";
import LoginPage from "./components/LoginPage";
import RegisterPage from "./components/RegisterPage";
import SubscriptionRowCard from "./components/SubscriptionRowCard";
import { useSongsPagination } from "./hooks/useSongsPagination";
import { useSongsSearch } from "./hooks/useSongsSearch";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

const AUTH_USER_KEY = "music_app_auth_user";

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getAuthUser() {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  const parsed = safeJsonParse(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function getRouteFromHash() {
  const hash = window.location.hash || "#/login";
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  if (cleaned === "/login") return "/login";
  if (cleaned === "/register") return "/register";
  return "/";
}

function MainPage({ authUser }) {
  const [libraryItems, setLibraryItems] = useState([]);
  const [subsError, setSubsError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [activeQuery, setActiveQuery] = useState(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [libraryPageIndex, setLibraryPageIndex] = useState(0);
  const [libraryNextCursor, setLibraryNextCursor] = useState(null);
  const [libraryCursorHistory, setLibraryCursorHistory] = useState([null]);
  const [libraryTotalSongs, setLibraryTotalSongs] = useState(null);
  const [libraryTotalPages, setLibraryTotalPages] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [queryForm, setQueryForm] = useState({
    title: "",
    year: "",
    artist: "",
    album: ""
  });

  const {
    queryResults,
    isLoadingSongs,
    songsError,
    currentPageIndex,
    hasNextPage,
    totalSongs,
    totalPages,
    isTotalApproximate,
    handleNextPage,
    handlePreviousPage
  } = useSongsPagination(API_BASE_URL, pageSize);

  const {
    queryResults: searchResults,
    isLoadingSongs: isLoadingSearch,
    songsError: searchError,
    currentPageIndex: searchCurrentPageIndex,
    hasNextPage: searchHasNextPage,
    totalSongs: searchTotalSongs,
    totalPages: searchTotalPages,
    isTotalApproximate: searchIsTotalApproximate,
    handleNextPage: handleSearchNextPage,
    handlePreviousPage: handleSearchPreviousPage
  } = useSongsSearch(API_BASE_URL, pageSize, activeQuery);

  const userEmail = authUser?.email;
  const isSearching = Boolean(activeQuery);

  const canQuery = Boolean(
    String(queryForm.title || "").trim() ||
      String(queryForm.year || "").trim() ||
      String(queryForm.artist || "").trim() ||
      String(queryForm.album || "").trim()
  );

  const displayedResults = isSearching ? searchResults : queryResults;
  const displayedIsLoading = isSearching ? isLoadingSearch : isLoadingSongs;
  const displayedError = isSearching ? searchError : songsError;
  const displayedCurrentPageIndex = isSearching ? searchCurrentPageIndex : currentPageIndex;
  const displayedHasNextPage = isSearching ? searchHasNextPage : hasNextPage;
  const displayedTotalSongs = isSearching ? searchTotalSongs : totalSongs;
  const displayedTotalPages = isSearching ? searchTotalPages : totalPages;
  const displayedIsTotalApproximate = isSearching
    ? searchIsTotalApproximate
    : isTotalApproximate;
  const displayedHandlePrevious = isSearching
    ? handleSearchPreviousPage
    : handlePreviousPage;
  const displayedHandleNext = isSearching ? handleSearchNextPage : handleNextPage;

  const fetchLibraryPage = useCallback(
    async (nextToken, pageIndex) => {
      if (!userEmail) {
        setLibraryItems([]);
        setLibraryPageIndex(0);
        setLibraryNextCursor(null);
        setLibraryCursorHistory([null]);
        setLibraryTotalSongs(null);
        setLibraryTotalPages(null);
        return;
      }

      setSubsError("");

      try {
        setIsLoadingLibrary(true);
        const params = new URLSearchParams({
          userEmail,
          limit: String(pageSize)
        });
        if (nextToken) params.set("nextToken", nextToken);

        const res = await fetch(`${API_BASE_URL}/subscriptions?${params.toString()}`);
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error?.message || `Request failed: ${res.status}`);
        }

        setLibraryItems(payload?.items || []);
        setLibraryPageIndex(pageIndex);
        setLibraryNextCursor(payload?.pagination?.nextToken || null);
        setLibraryTotalSongs(
          Number.isFinite(payload?.pagination?.totalSongs) ? payload.pagination.totalSongs : null
        );
        setLibraryTotalPages(
          Number.isFinite(payload?.pagination?.totalPages) ? payload.pagination.totalPages : null
        );
      } catch (err) {
        setSubsError(err?.message || "Failed to load subscriptions");
        setLibraryItems([]);
        setLibraryNextCursor(null);
        setLibraryTotalSongs(null);
        setLibraryTotalPages(null);
      } finally {
        setIsLoadingLibrary(false);
      }
    },
    [pageSize, userEmail]
  );

  useEffect(() => {
    if (!userEmail) {
      setLibraryItems([]);
      setLibraryPageIndex(0);
      setLibraryNextCursor(null);
      setLibraryCursorHistory([null]);
      setLibraryTotalSongs(null);
      setLibraryTotalPages(null);
      return;
    }

    setLibraryCursorHistory([null]);
    fetchLibraryPage(null, 0);
  }, [fetchLibraryPage, userEmail]);

  const handleLibraryNextPage = async () => {
    if (!libraryNextCursor || isLoadingLibrary) return;
    const nextIndex = libraryPageIndex + 1;
    setLibraryCursorHistory((prev) => [...prev, libraryNextCursor]);
    await fetchLibraryPage(libraryNextCursor, nextIndex);
  };

  const handleLibraryPreviousPage = async () => {
    if (libraryPageIndex === 0 || isLoadingLibrary) return;
    const previousIndex = libraryPageIndex - 1;
    const previousCursor = libraryCursorHistory[previousIndex] || null;
    await fetchLibraryPage(previousCursor, previousIndex);
  };

  async function postJson(path, payload) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data?.error?.message || data?.message || `Request failed: ${res.status}`;
      throw new Error(message);
    }

    return data;
  }

  const handleSubscribe = async (item) => {
    if (!userEmail) {
      setSubsError("Please login to manage your subscription.");
      return;
    }

    setSubsError("");

    const payload = {
      userEmail,
      artist: item.artist,
      songTitle: item.title,
      songKey: `${item.artist}#${item.title}`,
      album: item.album,
      year: item.year,
      image_url: item.image
    };

    try {
      await postJson("/subscriptions/subscribe", payload);
      setLibraryCursorHistory([null]);
      await fetchLibraryPage(null, 0);
    } catch (err) {
      setSubsError(err?.message || "Failed to subscribe");
    }
  };

  const handleRemove = async (itemId) => {
    if (!userEmail) return;

    const item = libraryItems.find((x) => x.id === itemId);
    if (!item) {
      return;
    }

    const payload = {
      userEmail,
      artist: item.artist,
      songTitle: item.title,
      songKey: `${item.artist}#${item.title}`
    };

    try {
      await postJson("/subscriptions/unsubscribe", payload);
      setLibraryCursorHistory([null]);
      await fetchLibraryPage(null, 0);
    } catch (err) {
      setSubsError(err?.message || "Failed to remove subscription");
    }
  };

  const subscribedSongIds = useMemo(
    () => new Set(libraryItems.map((item) => item.id)),
    [libraryItems]
  );

  return (
    <main className="main-layout">
      <aside className="query-area">
        <div className="results-header">
          <h2>Query</h2>
          <div className="pagination-settings">
            <label htmlFor="page-size">Rows:</label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </div>
        </div>

        <div className="query-form">
          <input
            type="text"
            placeholder="Title"
            value={queryForm.title}
            onChange={(e) => setQueryForm((prev) => ({ ...prev, title: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Year"
            value={queryForm.year}
            onChange={(e) => setQueryForm((prev) => ({ ...prev, year: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Artist"
            value={queryForm.artist}
            onChange={(e) => setQueryForm((prev) => ({ ...prev, artist: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Album"
            value={queryForm.album}
            onChange={(e) => setQueryForm((prev) => ({ ...prev, album: e.target.value }))}
          />
        </div>

        <div className="query-actions">
          <button
            type="button"
            className="pagination-btn"
            disabled={!canQuery || displayedIsLoading}
            onClick={() => {
              setQueryError("");
              if (!canQuery) {
                setQueryError("Please fill at least one field to query.");
                return;
              }

              setActiveQuery({
                title: queryForm.title.trim(),
                year: queryForm.year.trim(),
                artist: queryForm.artist.trim(),
                album: queryForm.album.trim()
              });
            }}
          >
            Query
          </button>
          <button
            type="button"
            className="pagination-btn"
            disabled={displayedIsLoading || !canQuery && !activeQuery}
            onClick={() => {
              setQueryError("");
              setActiveQuery(null);
              setQueryForm({
                title: "",
                year: "",
                artist: "",
                album: ""
              });
            }}
          >
            Clear
          </button>
        </div>

        <div className="subscribed-area">
          <h2>My Library</h2>
          {subsError ? <p className="empty-message">{subsError}</p> : null}
          {libraryItems.length === 0 ? (
            <div className="subscribed-empty">
              Your library is empty. Search and subscribe to music.
            </div>
          ) : (
            <div className="subscribed-list">
              {libraryItems.map((item) => (
                <SubscriptionRowCard
                  key={item.id}
                  item={item}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}

          {libraryItems.length > 0 ? (
            <div className="subscribed-pagination">
              <PaginationControls
                currentPageIndex={libraryPageIndex}
                isLoading={isLoadingLibrary}
                hasNextPage={Boolean(libraryNextCursor)}
                totalSongs={libraryTotalSongs}
                totalPages={libraryTotalPages}
                isTotalApproximate={false}
                onPrevious={handleLibraryPreviousPage}
                onNext={handleLibraryNextPage}
              />
            </div>
          ) : null}
        </div>
      </aside>

      <section className="library-area">
        <h2>Song Results</h2>
        {queryError ? <p className="empty-message">{queryError}</p> : null}

        {displayedIsLoading ? (
          <p className="empty-message">Loading songs...</p>
        ) : displayedError ? (
          <p className="empty-message">Failed to load songs: {displayedError}</p>
        ) : displayedResults.length === 0 ? (
          <p className="empty-message">No result is retrieved. Please query again</p>
        ) : (
          <div className="library-grid">
            {displayedResults.map((item) => (
              <ResultCard
                key={item.id}
                item={item}
                onSubscribe={handleSubscribe}
                isSubscribed={subscribedSongIds.has(item.id)}
              />
            ))}
          </div>
        )}

        <PaginationControls
          currentPageIndex={displayedCurrentPageIndex}
          isLoading={displayedIsLoading}
          hasNextPage={displayedHasNextPage}
          totalSongs={displayedTotalSongs}
          totalPages={displayedTotalPages}
          isTotalApproximate={displayedIsTotalApproximate}
          onPrevious={displayedHandlePrevious}
          onNext={displayedHandleNext}
        />
      </section>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => getRouteFromHash());
  const [authUser, setAuthUser] = useState(() => getAuthUser());

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (authUser && (route === "/login" || route === "/register")) {
      window.location.hash = "/";
    }
  }, [authUser, route]);

  const navigate = (nextRoute) => {
    window.location.hash = nextRoute;
  };

  const logout = () => {
    localStorage.removeItem(AUTH_USER_KEY);
    setAuthUser(null);
    navigate("/login");
  };

  const postJson = async (path, payload) => {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data?.error?.message || data?.message || `Request failed: ${res.status}`;
      throw new Error(message);
    }
    return data;
  };

  const handleLoginSuccess = async ({ email, password }) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const payload = await postJson("/login", {
      email: normalizedEmail,
      password
    });

    const user = payload?.user;
    if (!user?.email) throw new Error("Unable to log in. Please try again.");

    const sessionUser = { email: user.email, username: user.username || "" };
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(sessionUser));
    setAuthUser(sessionUser);
    navigate("/");
  };

  const handleRegisterSuccess = async ({ username, email, password }) => {
    const normalizedEmail = String(email).trim().toLowerCase();
    const payload = await postJson("/register", {
      username,
      email: normalizedEmail,
      password
    });

    const user = payload?.user;
    if (!user?.email) throw new Error("Unable to create account. Please try again.");
    // Assignment requirement: after successful registration, redirect to login page.
    navigate("/login");
  };

  const userArea = (
    <div className="user-area">
      {authUser && route !== "/" ? <a href="#/">Main Page</a> : null}

      {authUser ? (
        <>
          <span>Hi, {authUser.username || authUser.email}</span>
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              logout();
            }}
          >
            Logout
          </a>
        </>
      ) : (
        <>
          <a href="#/login">Login</a>
          <a href="#/register">Register</a>
        </>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="app-name">Music Explorer</div>
        {userArea}
      </header>

      {route === "/login" || !authUser && route === "/" ? (
        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          onSwitchToRegister={() => navigate("/register")}
        />
      ) : route === "/register" ? (
        <RegisterPage
          onRegisterSuccess={handleRegisterSuccess}
          onSwitchToLogin={() => navigate("/login")}
        />
      ) : (
        <MainPage authUser={authUser} />
      )}
    </div>
  );
}
