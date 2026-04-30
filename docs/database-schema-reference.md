# Database Schema Reference (DynamoDB)

This document lists the DynamoDB schemas to create for this project.

## 1) `music` table

Use for master song catalog (loaded from `2026a2_songs.json`).

### Primary key
- Partition key: `Artist` (String)
- Sort key: `SongTitle` (String)

### Attributes
- `Artist` (S)
- `SongTitle` (S)
- `Album` (S)
- `Year` (S)  // Keep as string for consistency with dataset
- `image_url` (S)

### Example item
```json
{
  "Artist": "Taylor Swift",
  "SongTitle": "Love Story",
  "Album": "Fearless",
  "Year": "2008",
  "image_url": "https://raw.githubusercontent.com/YingZhang2015/cc/main/TaylorSwift.jpg"
}
```

### Suggested indexes (for assignment criteria)
- **LSI1 (AlbumIndex)**  
  - Partition key: `Artist`  
  - Sort key: `Album`
- **GSI1 (YearArtistIndex)**  
  - Partition key: `Year`  
  - Sort key: `Artist`

> Note: LSI must be created when the table is created.

---

## 2) `login` table

Use for login/register users.

### Primary key
- Partition key: `Email` (String)

### Attributes
- `Email` (S)
- `UserName` (S)
- `Password` (S)
- `CreatedAt` (S, ISO timestamp) // optional but recommended

### Example item
```json
{
  "Email": "karan@example.com",
  "UserName": "karan",
  "Password": "password123",
  "CreatedAt": "2026-04-29T16:00:00.000Z"
}
```

---

## 3) `subscriptions` table

Use for per-user subscribed songs.

### Primary key
- Partition key: `UserEmail` (String)
- Sort key: `SongKey` (String)  
  - Format: `<Artist>#<SongTitle>`

### Attributes
- `UserEmail` (S)
- `SongKey` (S)
- `Artist` (S)
- `SongTitle` (S)
- `Album` (S)
- `Year` (S)
- `image_url` (S)
- `SubscribedAt` (S, ISO timestamp)

### Example item
```json
{
  "UserEmail": "karan@example.com",
  "SongKey": "Taylor Swift#Love Story",
  "Artist": "Taylor Swift",
  "SongTitle": "Love Story",
  "Album": "Fearless",
  "Year": "2008",
  "image_url": "https://raw.githubusercontent.com/YingZhang2015/cc/main/TaylorSwift.jpg",
  "SubscribedAt": "2026-04-29T16:00:00.000Z"
}
```

### Optional index
- **GSI1 (SongSubscribersIndex)**  
  - Partition key: `SongKey`  
  - Sort key: `UserEmail`

Use this only if you need "which users subscribed to this song?" queries.

---

## Naming and consistency rules

- Keep table names exactly:
  - `music`
  - `login`
  - `subscriptions`
- Keep attribute names/casing exactly as listed above.
- Keep `Year` type consistent across tables (`S` recommended here).
- Ensure app env values match table names (for example, `DYNAMODB_TABLE=music`).

---

## Quick create checklist

- [ ] Create `music` with PK (`Artist`, `SongTitle`)
- [ ] Add `music` LSI + GSI during table setup
- [ ] Create `login` with PK (`Email`)
- [ ] Create `subscriptions` with PK (`UserEmail`, `SongKey`)
- [ ] (Optional) add `subscriptions` GSI on `SongKey`
- [ ] Confirm all names/casing match this document exactly
