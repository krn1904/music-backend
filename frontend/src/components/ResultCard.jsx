import React from "react";

export default function ResultCard({ item, onSubscribe, isSubscribed }) {
  return (
    <div className="result-card">
      <div className="result-image-wrap">
        <img src={item.image} alt={item.title} className="result-image" />
      </div>
      <div className="result-content">
        <h3 className="result-title">{item.title}</h3>
        <p className="result-artist">{item.artist}</p>
        <p className="result-meta">{item.album} • {item.year}</p>
      </div>
      <button
        className={`subscribe-btn ${isSubscribed ? "subscribed" : ""}`}
        onClick={() => !isSubscribed && onSubscribe(item)}
        disabled={isSubscribed}
      >
        {isSubscribed ? "✓ Subscribed" : "+ Subscribe"}
      </button>
    </div>
  );
}
