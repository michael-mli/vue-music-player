# API Specifications

Complete API documentation for the Vue Music Player backend, including endpoints, request/response formats, authentication, and error handling.

## 🌐 Base Configuration

### Base URLs
- **Production**: `https://api.yourdomain.com/api`
- **Development**: `http://localhost:8080/api`
- **Staging**: `https://staging-api.yourdomain.com/api`

### Content Types
- **Request**: `application/json`
- **Response**: `application/json`
- **File Uploads**: `multipart/form-data`

### HTTP Methods
- `GET` - Retrieve data
- `POST` - Create new resources
- `PUT` - Update entire resources
- `PATCH` - Partial updates
- `DELETE` - Remove resources

## 🔐 Authentication

### Overview
The API uses JWT (JSON Web Tokens) for authentication with optional anonymous access for public endpoints.

### Authentication Headers
```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Public Endpoints (No Auth Required)
- `GET /songs` - List songs
- `GET /songs/:id` - Get song details
- `GET /songs/:id/lyrics` - Get song lyrics
- `GET /health` - Health check

### Protected Endpoints (Auth Required)
- `POST /playlists` - Create playlist
- `PUT /playlists/:id` - Update playlist
- `DELETE /playlists/:id` - Delete playlist
- `POST /favorites` - Add to favorites
- `DELETE /favorites/:songId` - Remove from favorites

## 📊 Standard Response Format

### Success Response
```json
{
  "data": <response_data>,
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1250,
    "hasMore": true
  },
  "meta": {
    "timestamp": "2024-01-15T10:30:00Z",
    "version": "1.0.0"
  }
}
```

### Error Response
```json
{
  "error": {
    "code": "SONG_NOT_FOUND",
    "message": "The requested song could not be found",
    "details": {
      "songId": 999,
      "timestamp": "2024-01-15T10:30:00Z"
    }
  }
}
```

### HTTP Status Codes
- `200` - OK (Success)
- `201` - Created
- `204` - No Content
- `400` - Bad Request (Validation Error)
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `429` - Too Many Requests (Rate Limited)
- `500` - Internal Server Error

## 🎵 Songs API

### List Songs
Get a paginated list of all songs with optional search and filtering.

**Endpoint**: `GET /songs`

**Query Parameters**:
- `limit` (integer, optional): Number of songs to return (1-100, default: 50)
- `offset` (integer, optional): Number of songs to skip (default: 0)
- `search` (string, optional): Search term for song titles
- `sort` (string, optional): Sort field (`id`, `title`, `created_at`) (default: `id`)
- `order` (string, optional): Sort order (`asc`, `desc`) (default: `asc`)

**Example Request**:
```http
GET /api/songs?limit=20&offset=0&search=love&sort=title&order=asc
```

**Example Response**:
```json
{
  "data": [
    {
      "id": 1,
      "title": "Love Song Example",
      "duration": 240,
      "file_size": 3840000,
      "file_format": "mp3",
      "url": "https://music.yourdomain.com/music/link.1.mp3",
      "lyricsUrl": "https://music.yourdomain.com/lyrics/link.1.mp3.l",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 45,
    "hasMore": true
  }
}
```

### Get Song Details
Retrieve detailed information about a specific song.

**Endpoint**: `GET /songs/:id`

**Path Parameters**:
- `id` (integer, required): Song ID (1-9999)

**Example Request**:
```http
GET /api/songs/123
```

**Example Response**:
```json
{
  "data": {
    "id": 123,
    "title": "Amazing Song Title",
    "duration": 195,
    "file_size": 3120000,
    "file_format": "mp3",
    "url": "https://music.yourdomain.com/music/link.123.mp3",
    "lyricsUrl": "https://music.yourdomain.com/lyrics/link.123.mp3.l",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "metadata": {
      "bitrate": 320,
      "sample_rate": 44100,
      "channels": 2
    }
  }
}
```

### Get Song Lyrics
Retrieve lyrics for a specific song.

**Endpoint**: `GET /songs/:id/lyrics`

**Path Parameters**:
- `id` (integer, required): Song ID

**Example Request**:
```http
GET /api/songs/123/lyrics
```

**Example Response**:
```json
{
  "data": {
    "songId": 123,
    "lyrics": "Verse 1:\nThis is the first line\nThis is the second line\n\nChorus:\nThis is the chorus\nSing along with me",
    "hasLyrics": true,
    "language": "en",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

**No Lyrics Response**:
```json
{
  "data": {
    "songId": 123,
    "lyrics": null,
    "hasLyrics": false
  }
}
```

## 📋 Playlists API

### List User Playlists
Get all playlists for a specific user.

**Endpoint**: `GET /playlists`

**Query Parameters**:
- `userId` (string, required): User identifier
- `includePublic` (boolean, optional): Include public playlists (default: false)

**Example Request**:
```http
GET /api/playlists?userId=user123&includePublic=true
```

**Example Response**:
```json
{
  "data": [
    {
      "id": 1,
      "name": "My Favorites",
      "description": "Songs I love to listen to",
      "user_id": "user123",
      "is_public": false,
      "song_count": 25,
      "total_duration": 6300,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-05T12:30:00Z"
    }
  ]
}
```

### Get Playlist Details
Retrieve detailed information about a specific playlist including all songs.

**Endpoint**: `GET /playlists/:id`

**Path Parameters**:
- `id` (integer, required): Playlist ID

**Query Parameters**:
- `includeSongs` (boolean, optional): Include song list (default: true)

**Example Request**:
```http
GET /api/playlists/1?includeSongs=true
```

**Example Response**:
```json
{
  "data": {
    "id": 1,
    "name": "My Favorites",
    "description": "Songs I love to listen to",
    "user_id": "user123",
    "is_public": false,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-05T12:30:00Z",
    "songs": [
      {
        "id": 1,
        "title": "Song Title",
        "duration": 240,
        "position": 1,
        "url": "https://music.yourdomain.com/music/link.1.mp3",
        "added_at": "2024-01-01T00:00:00Z"
      }
    ],
    "stats": {
      "song_count": 25,
      "total_duration": 6300,
      "last_played": "2024-01-10T15:45:00Z"
    }
  }
}
```

### Create Playlist
Create a new playlist for a user.

**Endpoint**: `POST /playlists`

**Authentication**: Required

**Request Body**:
```json
{
  "name": "My New Playlist",
  "description": "Description of the playlist",
  "is_public": false,
  "user_id": "user123"
}
```

**Example Response**:
```json
{
  "data": {
    "id": 5,
    "name": "My New Playlist",
    "description": "Description of the playlist",
    "user_id": "user123",
    "is_public": false,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### Update Playlist
Update playlist information.

**Endpoint**: `PUT /playlists/:id`

**Authentication**: Required

**Path Parameters**:
- `id` (integer, required): Playlist ID

**Request Body**:
```json
{
  "name": "Updated Playlist Name",
  "description": "Updated description",
  "is_public": true
}
```

**Example Response**:
```json
{
  "data": {
    "id": 1,
    "name": "Updated Playlist Name",
    "description": "Updated description",
    "user_id": "user123",
    "is_public": true,
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### Delete Playlist
Delete a playlist and all its associations.

**Endpoint**: `DELETE /playlists/:id`

**Authentication**: Required

**Path Parameters**:
- `id` (integer, required): Playlist ID

**Example Response**:
```http
HTTP/1.1 204 No Content
```

### Add Song to Playlist
Add a song to a specific playlist.

**Endpoint**: `POST /playlists/:id/songs`

**Authentication**: Required

**Path Parameters**:
- `id` (integer, required): Playlist ID

**Request Body**:
```json
{
  "song_id": 123,
  "position": 5
}
```

**Example Response**:
```json
{
  "data": {
    "playlist_id": 1,
    "song_id": 123,
    "position": 5,
    "added_at": "2024-01-15T10:30:00Z"
  }
}
```

### Remove Song from Playlist
Remove a song from a playlist.

**Endpoint**: `DELETE /playlists/:id/songs/:songId`

**Authentication**: Required

**Path Parameters**:
- `id` (integer, required): Playlist ID
- `songId` (integer, required): Song ID

**Example Response**:
```http
HTTP/1.1 204 No Content
```

### Reorder Playlist Songs
Update the order of songs in a playlist.

**Endpoint**: `PATCH /playlists/:id/songs/reorder`

**Authentication**: Required

**Request Body**:
```json
{
  "songs": [
    { "song_id": 1, "position": 1 },
    { "song_id": 5, "position": 2 },
    { "song_id": 3, "position": 3 }
  ]
}
```

**Example Response**:
```json
{
  "data": {
    "playlist_id": 1,
    "updated_songs": 3,
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

## ❤️ Favorites API

### Get User Favorites
Retrieve all favorite songs for a user.

**Endpoint**: `GET /favorites`

**Authentication**: Required

**Query Parameters**:
- `userId` (string, required): User identifier
- `limit` (integer, optional): Number of results (default: 50)
- `offset` (integer, optional): Pagination offset (default: 0)

**Example Request**:
```http
GET /api/favorites?userId=user123&limit=20&offset=0
```

**Example Response**:
```json
{
  "data": [
    {
      "id": 1,
      "title": "Favorite Song",
      "duration": 240,
      "url": "https://music.yourdomain.com/music/link.1.mp3",
      "favorited_at": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 15,
    "hasMore": false
  }
}
```

### Add to Favorites
Add a song to user's favorites.

**Endpoint**: `POST /favorites`

**Authentication**: Required

**Request Body**:
```json
{
  "user_id": "user123",
  "song_id": 123
}
```

**Example Response**:
```json
{
  "data": {
    "user_id": "user123",
    "song_id": 123,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### Remove from Favorites
Remove a song from user's favorites.

**Endpoint**: `DELETE /favorites/:songId`

**Authentication**: Required

**Path Parameters**:
- `songId` (integer, required): Song ID

**Query Parameters**:
- `userId` (string, required): User identifier

**Example Request**:
```http
DELETE /api/favorites/123?userId=user123
```

**Example Response**:
```http
HTTP/1.1 204 No Content
```

## 🔍 Search API

### Advanced Search
Perform advanced search across songs with multiple criteria.

**Endpoint**: `GET /search`

**Query Parameters**:
- `q` (string, required): Search query
- `type` (string, optional): Search type (`songs`, `playlists`, `all`) (default: `all`)
- `limit` (integer, optional): Results limit (default: 20)
- `offset` (integer, optional): Pagination offset (default: 0)

**Example Request**:
```http
GET /api/search?q=love&type=songs&limit=10
```

**Example Response**:
```json
{
  "data": {
    "songs": [
      {
        "id": 1,
        "title": "Love Song",
        "duration": 240,
        "url": "https://music.yourdomain.com/music/link.1.mp3",
        "relevance_score": 0.95
      }
    ],
    "playlists": [],
    "total_results": 15
  },
  "pagination": {
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

## 📈 Analytics API

### Song Play Event
Track when a song is played.

**Endpoint**: `POST /analytics/play`

**Authentication**: Optional

**Request Body**:
```json
{
  "song_id": 123,
  "user_id": "user123",
  "duration_played": 180,
  "total_duration": 240,
  "session_id": "session_abc123",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example Response**:
```json
{
  "data": {
    "recorded": true,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### User Session
Create or update user session.

**Endpoint**: `POST /analytics/session`

**Request Body**:
```json
{
  "user_id": "user123",
  "session_id": "session_abc123",
  "action": "start",
  "metadata": {
    "user_agent": "Mozilla/5.0...",
    "referrer": "https://music.yourdomain.com",
    "device_type": "desktop"
  }
}
```

## 🔧 System API

### Health Check
Check API health and status.

**Endpoint**: `GET /health`

**Example Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "services": {
    "database": "healthy",
    "storage": "healthy",
    "cache": "healthy"
  },
  "metrics": {
    "uptime": 86400,
    "requests_per_minute": 150,
    "average_response_time": 45
  }
}
```

### API Information
Get API version and capabilities.

**Endpoint**: `GET /info`

**Example Response**:
```json
{
  "api_version": "1.0.0",
  "supported_formats": ["mp3", "wav", "ogg"],
  "max_file_size": 52428800,
  "rate_limits": {
    "anonymous": 60,
    "authenticated": 300
  },
  "features": {
    "search": true,
    "playlists": true,
    "favorites": true,
    "analytics": true
  }
}
```

## ⚠️ Error Handling

### Error Codes
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `SONG_NOT_FOUND` | 404 | Song with specified ID not found |
| `PLAYLIST_NOT_FOUND` | 404 | Playlist with specified ID not found |
| `UNAUTHORIZED` | 401 | Invalid or missing authentication |
| `FORBIDDEN` | 403 | User lacks permission for this action |
| `VALIDATION_ERROR` | 400 | Request data validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests from client |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

### Validation Errors
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fields": [
        {
          "field": "song_id",
          "message": "Song ID must be between 1 and 9999",
          "value": 10000
        },
        {
          "field": "playlist_name",
          "message": "Playlist name is required",
          "value": null
        }
      ]
    }
  }
}
```

## 🔒 Rate Limiting

### Limits by User Type
- **Anonymous**: 60 requests/minute
- **Authenticated**: 300 requests/minute
- **Premium**: 1000 requests/minute

### Rate Limit Headers
```http
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 250
X-RateLimit-Reset: 1642251600
Retry-After: 60
```

### Rate Limit Response
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded",
    "details": {
      "limit": 300,
      "remaining": 0,
      "reset_at": "2024-01-15T10:31:00Z"
    }
  }
}
```

## 📝 Request/Response Examples

### Create Playlist with Songs
```http
POST /api/playlists
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "name": "Road Trip Mix",
  "description": "Perfect songs for long drives",
  "is_public": true,
  "user_id": "user123",
  "songs": [
    {"song_id": 1, "position": 1},
    {"song_id": 5, "position": 2},
    {"song_id": 10, "position": 3}
  ]
}
```

### Batch Operations
```http
POST /api/batch
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "operations": [
    {
      "method": "POST",
      "endpoint": "/favorites",
      "data": {"song_id": 1, "user_id": "user123"}
    },
    {
      "method": "POST", 
      "endpoint": "/favorites",
      "data": {"song_id": 2, "user_id": "user123"}
    }
  ]
}
```

---

**Related Documentation:**
- [Cloudflare Backend Guide](./16-Cloudflare-Backend.md)
- [Network Handling](./15-Network-Handling.md)
- [Common Issues](./19-Common-Issues.md)