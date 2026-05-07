import React from "react";

export default function SubscriptionRowCard({ item, onRemove }) {
  const fullTitle = `${item.title} — ${item.artist} • ${item.album} • ${item.year}`;
  const itemId = `${String(item?.artist || "").trim()}-${String(item?.title || "").trim()}-${String(
    item?.year || ""
  ).trim()}`;

  return (
    <div className="subscription-row" title={fullTitle}>
      <img src={item.image} alt={item.artist} className="subscription-row-image" />
      <div className="subscription-row-content">
        <h3 className="subscription-row-title" title={item.title}>{item.title}</h3>
        <p className="subscription-row-artist" title={item.artist}>{item.artist}</p>
        <p className="subscription-row-meta" title={`${item.album} • ${item.year}`}>
          {item.album} • {item.year}
        </p>
      </div>
      <button
        className="subscription-row-remove-btn"
        onClick={() => onRemove(itemId)}
        title="Remove from library"
        aria-label={`Remove ${item.title} from library`}
      >
        Remove
      </button>
    </div>
  );
}
