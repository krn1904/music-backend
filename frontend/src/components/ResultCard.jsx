import React from "react";

export default function ResultCard({ item, onSubscribe, isSubscribed }) {
  return (
    <div className="result-card">
      <img src={item.image} alt={item.artist} className="result-image" />
      <div className="result-content">
        <h3>{item.title}</h3>
        <p>
          {item.artist} • {item.album} • {item.year}
        </p>
      </div>
      <button
        className={`subscribe-btn ${isSubscribed ? "subscribed" : ""}`}
        onClick={() => onSubscribe(item)}
        disabled={isSubscribed}
      >
        {isSubscribed ? "Subscribed" : "＋ Subscribe"}
      </button>
    </div>
  );
}
