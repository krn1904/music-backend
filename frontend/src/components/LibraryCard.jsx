import React from "react";

export default function LibraryCard({ item, onRemove }) {
  return (
    <div className="library-card">
      <img src={item.image} alt={item.artist} className="library-image" />
      <div className="library-content">
        <h3>{item.title}</h3>
        <p>
          {item.artist} • {item.album} • {item.year}
        </p>
        <button className="remove-btn" onClick={() => onRemove(item.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}
