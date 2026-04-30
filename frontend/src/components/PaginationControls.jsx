import React from "react";

export default function PaginationControls({
  currentPageIndex,
  isLoading,
  hasNextPage,
  totalSongs,
  totalPages,
  isTotalApproximate,
  onPrevious,
  onNext
}) {
  return (
    <div>
      <div className="pagination-summary">
        {totalSongs == null ? (
          <span>Total songs unavailable</span>
        ) : (
          <span>
            {isTotalApproximate ? "Approx. " : ""}{totalSongs} {totalSongs === 1 ? "song" : "songs"}
            {totalPages
              ? ` • ${totalPages} ${totalPages === 1 ? "page" : "pages"}`
              : ""}
          </span>
        )}
      </div>
      <div className="pagination-controls">
      <button
        type="button"
        className="pagination-btn"
        onClick={onPrevious}
        disabled={currentPageIndex === 0 || isLoading}
      >
        Previous
      </button>
      <span className="pagination-status">Page {currentPageIndex + 1}</span>
      <button
        type="button"
        className="pagination-btn"
        onClick={onNext}
        disabled={!hasNextPage || isLoading}
      >
        Next
      </button>
      </div>
    </div>
  );
}
