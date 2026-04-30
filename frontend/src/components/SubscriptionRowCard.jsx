import React from "react";

export default function SubscriptionRowCard({ item, onRemove }) {
  return (
    <div className="subscription-row">
      <img src={item.image} alt={item.artist} className="subscription-row-image" />
      <div className="subscription-row-content">
        <h3 className="subscription-row-title">{item.title}</h3>
        <p className="subscription-row-meta">
          {item.artist} • {item.album} • {item.year}
        </p>
      </div>
      <button className="subscription-row-remove-btn" onClick={() => onRemove(item.id)}>
        Remove
      </button>
    </div>
  );
}

