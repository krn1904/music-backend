import React from "react";

export default function PaginationControls({
  currentPageIndex,
  isLoading,
  hasNextPage,
  onPrevious,
  onNext
}) {
  return (
    <div>
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
