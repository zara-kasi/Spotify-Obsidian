# Spotify Plugin Usage Guide - All Code Blocks

## 1. Basic Spotify Code Block

### Track Display
```spotify
type: track
id: 4iV5W9uYEdYUVa79Axb7Rh
layout: card
```

### Album Display  
```spotify
type: album
id: 1DFixLWuPkv3KT3TnV35m3
layout: card
```

### Artist Display
```spotify
type: artist
id: 06HL4z0CvFAxyc27GXpf02
layout: card
```

### Playlist Display
```spotify
type: playlist
id: 37i9dQZF1DXcBWIGoYBM5M
layout: list
```

## 2. Using URLs Instead of IDs

### Track from URL
```spotify
type: track
url: https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
layout: card
```

### Album from URL
```spotify
type: album
url: https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3
layout: list
```

### Artist from URL
```spotify
type: artist
url: https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02
layout: grid
```

### Playlist from URL
```spotify
type: playlist
url: https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
layout: card
```

## 3. Layout Options

### Card Layout (Default)
```spotify
type: track
id: 4iV5W9uYEdYUVa79Axb7Rh
layout: card
```

### List Layout
```spotify
type: album
id: 1DFixLWuPkv3KT3TnV35m3
layout: list
```

### Grid Layout
```spotify
type: artist
id: 06HL4z0CvFAxyc27GXpf02
layout: grid
```

### Inline Layout
```spotify
type: track
id: 4iV5W9uYEdYUVa79Axb7Rh
layout: inline
```

## 4. Search Interface

### Search for Tracks
```spotify-search
searchType: track
limit: 10
layout: card
```

### Search for Albums
```spotify-search
searchType: album
limit: 15
layout: list
```

### Search for Artists
```spotify-search
searchType: artist
limit: 20
layout: grid
```

### Search for Playlists
```spotify-search
searchType: playlist
limit: 10
layout: card
```

## 5. Advanced Configuration Options

### Custom Limit for Results
```spotify
type: playlist
id: 37i9dQZF1DXcBWIGoYBM5M
limit: 50
layout: list
```

### Multiple Configuration Example
```spotify
type: album
url: https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3
layout: card
limit: 30
```

## 6. Inline Spotify Links

You can also use inline Spotify links directly in your markdown:

```markdown
Check out this track: [spotify:track:4iV5W9uYEdYUVa79Axb7Rh]
Listen to this album: [spotify:album:1DFixLWuPkv3KT3TnV35m3]
Follow this artist: [spotify:artist:06HL4z0CvFAxyc27GXpf02]
```

## Available Parameters

### Required Parameters
- `type`: track, album, artist, or playlist
- `id`: Spotify ID OR `url`: Spotify URL (one of these is required)

### Optional Parameters
- `layout`: card, list, grid, or inline (defaults to plugin setting)
- `limit`: Number of results to show (5-50, defaults to plugin setting)

### Search Block Parameters
- `searchType`: track, album, artist, or playlist
- `limit`: Number of search results (5-50)
- `layout`: Display layout for results

## Display Settings (Controlled by Plugin Settings)

The plugin settings control what information is displayed:

- **Show Album Art**: Display cover images
- **Show Artist**: Display artist names
- **Show Album**: Display album names for tracks
- **Show Duration**: Display track lengths
- **Show Genres**: Display genre information for artists
- **Show Popularity**: Display popularity scores
- **Grid Columns**: Number of columns for grid layout (1-5)
- **Max Results**: Default maximum results (5-50)

## Examples with Real Spotify Content

### Popular Track
```spotify
type: track
id: 7qiZfU4dY1lWllzX7mPBI3
layout: card
```

### Classic Album
```spotify
type: album
id: 2ANVost0y2y52ema1E9xAZ
layout: list
```

### Famous Artist
```spotify
type: artist
id: 1dfeR4HaWDbWqFHLkxsg1d
layout: card
```

### Curated Playlist
```spotify
type: playlist
id: 37i9dQZF1DX0XUsuxWHRQd
layout: list
limit: 25
```

## Error Handling

If there's an issue with your code block, the plugin will display an error message. Common issues:

- Missing or invalid Spotify ID/URL
- Invalid type parameter
- Network connectivity issues
- Invalid Spotify API credentials

## Setup Requirements

Before using these code blocks, you need to:

1. Get Spotify API credentials from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Enter your Client ID and Client Secret in the plugin settings
3. Test the connection in the settings panel

The plugin uses Spotify's Client Credentials flow, so it can access public Spotify data without requiring user authentication.
