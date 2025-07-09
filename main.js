const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

class SpotifyPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async onload() {
    console.log('Loading Spotify Plugin');
    
    // Load settings first
    await this.loadSettings();
    
    // Register code block processors
    this.registerMarkdownCodeBlockProcessor('spotify', this.processSpotifyCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('spotify-search', this.processSpotifySearchCodeBlock.bind(this));
    
    // Register inline link processor
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
    
    // Add plugin settings
    this.addSettingTab(new SpotifySettingTab(this.app, this));
    
    // Initialize authentication if credentials are available
    if (this.settings.clientId && this.settings.clientSecret) {
      await this.authenticateSpotify();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, {
      clientId: '',
      clientSecret: '',
      defaultUserId: '',
      defaultLayout: 'card',
      showAlbumArt: true,
      showArtist: true,
      showAlbum: true,
      showDuration: true,
      showGenres: false,
      showPopularity: true,
      gridColumns: 3,
      maxResults: 20
    }, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Spotify Authentication using Client Credentials Flow
  async authenticateSpotify() {
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(this.settings.clientId + ':' + this.settings.clientSecret)
        },
        body: 'grant_type=client_credentials'
      });

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      console.log('Spotify authentication successful');
      return true;
    } catch (error) {
      console.error('Spotify authentication error:', error);
      new Notice('Spotify authentication failed. Please check your credentials.');
      return false;
    }
  }

  // Check if token is valid and refresh if needed
  async ensureValidToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      return await this.authenticateSpotify();
    }
    return true;
  }

  async processSpotifyCodeBlock(source, el, ctx) {
    try {
      const config = this.parseCodeBlockConfig(source);
      const data = await this.fetchSpotifyData(config);
      this.renderSpotifyData(el, data, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

  async processSpotifySearchCodeBlock(source, el, ctx) {
    try {
      const config = this.parseSearchCodeBlockConfig(source);
      this.renderSearchInterface(el, config);
    } catch (error) {
      this.renderError(el, error.message);
    }
  }

  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    // Set defaults
    config.layout = config.layout || this.settings.defaultLayout;
    config.type = config.type || 'playlist'; // playlist, album, track, artist
    config.limit = config.limit || this.settings.maxResults;
    
    return config;
  }

  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        config[key] = value;
      }
    }
    
    // Default search type to track if not specified
    config.searchType = config.searchType || 'track'; // track, album, artist, playlist
    config.layout = config.layout || this.settings.defaultLayout;
    config.limit = config.limit || this.settings.maxResults;
    
    return config;
  }

  async processInlineLinks(el, ctx) {
    const inlineLinks = el.querySelectorAll('a[href^="spotify:"]');
    
    for (const link of inlineLinks) {
      const href = link.getAttribute('href');
      try {
        const config = this.parseInlineLink(href);
        const data = await this.fetchSpotifyData(config);
        
        const container = document.createElement('div');
        container.className = 'spotify-inline-container';
        this.renderSpotifyData(container, data, config);
        
        link.parentNode.replaceChild(container, link);
      } catch (error) {
        this.renderError(link, error.message);
      }
    }
  }

  parseInlineLink(href) {
    // Parse: spotify:track:4iV5W9uYEdYUVa79Axb7Rh or spotify:album:1A2GTWGtFfWp7KSQTwWOyo
    const parts = href.replace('spotify:', '').split(':');
    
    if (parts.length < 2) {
      throw new Error('Invalid Spotify link format');
    }
    
    const config = {
      type: 'single',
      itemType: parts[0], // track, album, artist, playlist
      itemId: parts[1],
      layout: 'card'
    };
    
    return config;
  }

  renderError(el, message) {
    el.innerHTML = `<div class="spotify-error">Error: ${message}</div>`;
  }

  onunload() {
    console.log('Unloading Spotify Plugin');
  }
}

class SpotifySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    
    containerEl.createEl('h2', { text: 'Spotify Integration Settings' });

    // Authentication Section
    containerEl.createEl('h3', { text: 'Authentication' });
    
    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Your Spotify App Client ID (Create an app at https://developer.spotify.com/dashboard)')
      .addText(text => text
        .setPlaceholder('Enter your Spotify Client ID')
        .setValue(this.plugin.settings.clientId)
        .onChange(async (value) => {
          this.plugin.settings.clientId = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Client Secret')
      .setDesc('Your Spotify App Client Secret')
      .addText(text => text
        .setPlaceholder('Enter your Spotify Client Secret')
        .setValue(this.plugin.settings.clientSecret)
        .onChange(async (value) => {
          this.plugin.settings.clientSecret = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Test your Spotify API connection')
      .addButton(button => button
        .setButtonText('Test Connection')
        .onClick(async () => {
          if (!this.plugin.settings.clientId || !this.plugin.settings.clientSecret) {
            new Notice('Please enter both Client ID and Client Secret first.');
            return;
          }
          
          const success = await this.plugin.authenticateSpotify();
          if (success) {
            new Notice('✅ Spotify connection successful!');
          } else {
            new Notice('❌ Spotify connection failed. Check your credentials.');
          }
        }));

    // Display Settings Section
    containerEl.createEl('h3', { text: 'Display Settings' });
    
    new Setting(containerEl)
      .setName('Default Layout')
      .setDesc('Choose the default layout for displaying music')
      .addDropdown(dropdown => dropdown
        .addOption('card', 'Card Layout')
        .addOption('table', 'Table Layout')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async (value) => {
          this.plugin.settings.defaultLayout = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Album Art')
      .setDesc('Display album artwork')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showAlbumArt)
        .onChange(async (value) => {
          this.plugin.settings.showAlbumArt = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Artist')
      .setDesc('Display artist information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showArtist)
        .onChange(async (value) => {
          this.plugin.settings.showArtist = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Album')
      .setDesc('Display album information')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showAlbum)
        .onChange(async (value) => {
          this.plugin.settings.showAlbum = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Duration')
      .setDesc('Display track duration')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showDuration)
        .onChange(async (value) => {
          this.plugin.settings.showDuration = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Genres')
      .setDesc('Display genre information (when available)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Popularity')
      .setDesc('Display popularity score')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showPopularity)
        .onChange(async (value) => {
          this.plugin.settings.showPopularity = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Grid Columns')
      .setDesc('Number of columns in card grid layout')
      .addSlider(slider => slider
        .setLimits(1, 6, 1)
        .setValue(this.plugin.settings.gridColumns)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.gridColumns = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max Results')
      .setDesc('Maximum number of results to display')
      .addSlider(slider => slider
        .setLimits(5, 50, 5)
        .setValue(this.plugin.settings.maxResults)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxResults = value;
          await this.plugin.saveSettings();
        }));

    // Documentation Section
    containerEl.createEl('h3', { text: 'Documentation' });
    
    new Setting(containerEl)
      .setName('Setup Guide')
      .setDesc('Learn how to set up the Spotify plugin')
      .addButton(button => button
        .setButtonText('View Setup Guide')
        .onClick(() => {
          window.open('https://developer.spotify.com/documentation/web-api/tutorials/getting-started', '_blank');
        }));
  }
}

module.exports = SpotifyPlugin;

// Part 2: Data Fetching and API Integration Methods
// Add these methods to your SpotifyPlugin class

class SpotifyPlugin extends Plugin {
  // ... existing Part 1 code ...

  /**
   * Main method to fetch Spotify data based on configuration
   * @param {Object} config - Configuration object containing type, query, etc.
   * @returns {Promise<Object>} - Spotify API response data
   */
  async fetchSpotifyData(config) {
    const cacheKey = JSON.stringify(config);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    try {
      let data;
      
      switch (config.type) {
        case 'track':
          data = await this.fetchTrack(config.id);
          break;
        case 'album':
          data = await this.fetchAlbum(config.id);
          break;
        case 'artist':
          data = await this.fetchArtist(config.id);
          break;
        case 'playlist':
          data = await this.fetchPlaylist(config.id);
          break;
        case 'search':
          data = await this.searchSpotify(config.query, config.searchType, config.limit);
          break;
        case 'user-playlists':
          data = await this.fetchUserPlaylists(config.userId);
          break;
        case 'user-top-tracks':
          data = await this.fetchUserTopTracks(config.timeRange, config.limit);
          break;
        case 'user-top-artists':
          data = await this.fetchUserTopArtists(config.timeRange, config.limit);
          break;
        case 'recently-played':
          data = await this.fetchRecentlyPlayed(config.limit);
          break;
        case 'current-playing':
          data = await this.fetchCurrentlyPlaying();
          break;
        default:
          throw new Error(`Unknown data type: ${config.type}`);
      }
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      console.error('Error fetching Spotify data:', error);
      throw error;
    }
  }

  /**
   * Fetch a single track by ID
   * @param {string} trackId - Spotify track ID
   * @returns {Promise<Object>} - Track data
   */
  async fetchTrack(trackId) {
    const response = await this.makeSpotifyRequest(`/tracks/${trackId}`);
    return response;
  }

  /**
   * Fetch an album by ID with its tracks
   * @param {string} albumId - Spotify album ID
   * @returns {Promise<Object>} - Album data with tracks
   */
  async fetchAlbum(albumId) {
    const [album, tracks] = await Promise.all([
      this.makeSpotifyRequest(`/albums/${albumId}`),
      this.makeSpotifyRequest(`/albums/${albumId}/tracks?limit=50`)
    ]);
    
    return {
      ...album,
      tracks: tracks
    };
  }

  /**
   * Fetch an artist by ID with top tracks and albums
   * @param {string} artistId - Spotify artist ID
   * @returns {Promise<Object>} - Artist data with top tracks and albums
   */
  async fetchArtist(artistId) {
    const [artist, topTracks, albums] = await Promise.all([
      this.makeSpotifyRequest(`/artists/${artistId}`),
      this.makeSpotifyRequest(`/artists/${artistId}/top-tracks?market=US`),
      this.makeSpotifyRequest(`/artists/${artistId}/albums?include_groups=album,single&market=US&limit=20`)
    ]);
    
    return {
      ...artist,
      topTracks: topTracks.tracks,
      albums: albums.items
    };
  }

  /**
   * Fetch a playlist by ID with its tracks
   * @param {string} playlistId - Spotify playlist ID
   * @returns {Promise<Object>} - Playlist data with tracks
   */
  async fetchPlaylist(playlistId) {
    const playlist = await this.makeSpotifyRequest(`/playlists/${playlistId}`);
    
    // If playlist has many tracks, fetch all of them
    if (playlist.tracks.total > 100) {
      const allTracks = await this.fetchAllPlaylistTracks(playlistId);
      playlist.tracks.items = allTracks;
    }
    
    return playlist;
  }

  /**
   * Fetch all tracks from a playlist (handles pagination)
   * @param {string} playlistId - Spotify playlist ID
   * @returns {Promise<Array>} - Array of track items
   */
  async fetchAllPlaylistTracks(playlistId) {
    const tracks = [];
    let offset = 0;
    const limit = 100;
    
    while (true) {
      const response = await this.makeSpotifyRequest(
        `/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`
      );
      
      tracks.push(...response.items);
      
      if (response.items.length < limit) {
        break;
      }
      
      offset += limit;
    }
    
    return tracks;
  }

  /**
   * Search Spotify for tracks, albums, artists, or playlists
   * @param {string} query - Search query
   * @param {string} type - Search type (track, album, artist, playlist)
   * @param {number} limit - Number of results to return
   * @returns {Promise<Object>} - Search results
   */
  async searchSpotify(query, type = 'track', limit = 20) {
    const encodedQuery = encodeURIComponent(query);
    const response = await this.makeSpotifyRequest(
      `/search?q=${encodedQuery}&type=${type}&limit=${limit}`
    );
    
    return response;
  }

  /**
   * Fetch user's playlists
   * @param {string} userId - Spotify user ID (optional, uses current user if not provided)
   * @returns {Promise<Object>} - User's playlists
   */
  async fetchUserPlaylists(userId = null) {
    const endpoint = userId ? `/users/${userId}/playlists` : '/me/playlists';
    return await this.makeSpotifyRequest(`${endpoint}?limit=50`);
  }

  /**
   * Fetch user's top tracks
   * @param {string} timeRange - Time range (short_term, medium_term, long_term)
   * @param {number} limit - Number of tracks to return
   * @returns {Promise<Object>} - User's top tracks
   */
  async fetchUserTopTracks(timeRange = 'medium_term', limit = 20) {
    return await this.makeSpotifyRequest(
      `/me/top/tracks?time_range=${timeRange}&limit=${limit}`
    );
  }

  /**
   * Fetch user's top artists
   * @param {string} timeRange - Time range (short_term, medium_term, long_term)
   * @param {number} limit - Number of artists to return
   * @returns {Promise<Object>} - User's top artists
   */
  async fetchUserTopArtists(timeRange = 'medium_term', limit = 20) {
    return await this.makeSpotifyRequest(
      `/me/top/artists?time_range=${timeRange}&limit=${limit}`
    );
  }

  /**
   * Fetch recently played tracks
   * @param {number} limit - Number of tracks to return
   * @returns {Promise<Object>} - Recently played tracks
   */
  async fetchRecentlyPlayed(limit = 20) {
    return await this.makeSpotifyRequest(`/me/player/recently-played?limit=${limit}`);
  }

  /**
   * Fetch currently playing track
   * @returns {Promise<Object>} - Currently playing track
   */
  async fetchCurrentlyPlaying() {
    return await this.makeSpotifyRequest('/me/player/currently-playing');
  }

  /**
   * Make a request to the Spotify API
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {Object} body - Request body for POST/PUT requests
   * @returns {Promise<Object>} - API response
   */
  async makeSpotifyRequest(endpoint, method = 'GET', body = null) {
    const accessToken = await this.getValidAccessToken();
    
    const url = `https://api.spotify.com/v1${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    
    const options = {
      method,
      headers
    };
    
    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Spotify API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }
    
    // Handle 204 No Content responses (e.g., from some player endpoints)
    if (response.status === 204) {
      return null;
    }
    
    return await response.json();
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} - Valid access token
   */
  async getValidAccessToken() {
    if (!this.settings.accessToken) {
      throw new Error('No access token available. Please authenticate first.');
    }
    
    // Check if token is expired (with 5-minute buffer)
    const now = Date.now();
    const tokenExpiresAt = this.settings.tokenExpiresAt || 0;
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    
    if (now >= (tokenExpiresAt - bufferTime)) {
      await this.refreshAccessToken();
    }
    
    return this.settings.accessToken;
  }

  /**
   * Refresh the access token using the refresh token
   * @returns {Promise<void>}
   */
  async refreshAccessToken() {
    if (!this.settings.refreshToken) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${this.settings.clientId}:${this.settings.clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.settings.refreshToken
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to refresh access token');
    }
    
    const data = await response.json();
    
    this.settings.accessToken = data.access_token;
    this.settings.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    
    // Update refresh token if provided
    if (data.refresh_token) {
      this.settings.refreshToken = data.refresh_token;
    }
    
    await this.saveSettings();
  }

  /**
   * Extract Spotify ID from various URL formats
   * @param {string} url - Spotify URL or URI
   * @returns {string} - Extracted Spotify ID
   */
  extractSpotifyId(url) {
    // Handle different Spotify URL formats
    const patterns = [
      /spotify:(\w+):([a-zA-Z0-9]+)/,           // spotify:track:4iV5W9uYEdYUVa79Axb7Rh
      /open\.spotify\.com\/(\w+)\/([a-zA-Z0-9]+)/, // https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
      /^([a-zA-Z0-9]+)$/                        // Direct ID
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[2] || match[1];
      }
    }
    
    throw new Error('Invalid Spotify URL or ID format');
  }

  /**
   * Get the type of Spotify content from URL
   * @param {string} url - Spotify URL or URI
   * @returns {string} - Content type (track, album, artist, playlist)
   */
  getSpotifyContentType(url) {
    const patterns = [
      /spotify:(\w+):/,                    // spotify:track:
      /open\.spotify\.com\/(\w+)\//        // https://open.spotify.com/track/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return 'track'; // Default to track
  }

  /**
   * Format duration from milliseconds to MM:SS
   * @param {number} ms - Duration in milliseconds
   * @returns {string} - Formatted duration
   */
  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Format date from ISO string to readable format
   * @param {string} dateString - ISO date string
   * @returns {string} - Formatted date
   */
  formatDate(dateString) {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Get artist names from an array of artist objects
   * @param {Array} artists - Array of artist objects
   * @returns {string} - Comma-separated artist names
   */
  getArtistNames(artists) {
    if (!artists || !Array.isArray(artists)) return '';
    return artists.map(artist => artist.name).join(', ');
  }

  /**
   * Generate Spotify URL for opening in browser/app
   * @param {string} type - Content type (track, album, artist, playlist)
   * @param {string} id - Spotify ID
   * @returns {string} - Spotify URL
   */
  getSpotifyUrl(type, id) {
    return `https://open.spotify.com/${type}/${id}`;
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Helper functions for data processing

/**
 * Process track data for display
 * @param {Object} track - Raw track data from Spotify API
 * @returns {Object} - Processed track data
 */
function processTrackData(track) {
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map(artist => ({
      id: artist.id,
      name: artist.name
    })),
    album: {
      id: track.album.id,
      name: track.album.name,
      image: track.album.images[0]?.url
    },
    duration: track.duration_ms,
    explicit: track.explicit,
    preview_url: track.preview_url,
    external_urls: track.external_urls,
    popularity: track.popularity
  };
}

/**
 * Process album data for display
 * @param {Object} album - Raw album data from Spotify API
 * @returns {Object} - Processed album data
 */
function processAlbumData(album) {
  return {
    id: album.id,
    name: album.name,
    artists: album.artists.map(artist => ({
      id: artist.id,
      name: artist.name
    })),
    image: album.images[0]?.url,
    release_date: album.release_date,
    total_tracks: album.total_tracks,
    external_urls: album.external_urls,
    tracks: album.tracks?.items?.map(track => processTrackData(track)) || []
  };
}

/**
 * Process artist data for display
 * @param {Object} artist - Raw artist data from Spotify API
 * @returns {Object} - Processed artist data
 */
function processArtistData(artist) {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres,
    image: artist.images[0]?.url,
    followers: artist.followers.total,
    popularity: artist.popularity,
    external_urls: artist.external_urls
  };
}

/**
 * Process playlist data for display
 * @param {Object} playlist - Raw playlist data from Spotify API
 * @returns {Object} - Processed playlist data
 */
function processPlaylistData(playlist) {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    owner: playlist.owner.display_name,
    image: playlist.images[0]?.url,
    total_tracks: playlist.tracks.total,
    external_urls: playlist.external_urls,
    tracks: playlist.tracks?.items?.map(item => processTrackData(item.track)) || []
  };
  }

// Part 3: Code Block Processing and Rendering Methods
// Add these methods to your SpotifyPlugin class

/**
 * Register all code block processors during plugin initialization
 * Call this method in your onload() function
 */
registerCodeBlockProcessors() {
  // Register main spotify code block processor
  this.registerMarkdownCodeBlockProcessor('spotify', this.processSpotifyCodeBlock.bind(this));
  
  // Register search code block processor
  this.registerMarkdownCodeBlockProcessor('spotify-search', this.processSpotifySearchCodeBlock.bind(this));
  
  // Register user stats code block processor
  this.registerMarkdownCodeBlockProcessor('spotify-user', this.processSpotifyUserCodeBlock.bind(this));
  
  // Register inline link processor for spotify: links
  this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
}

/**
 * Process main spotify code blocks
 * Handles individual tracks, albums, artists, playlists
 */
async processSpotifyCodeBlock(source, el, ctx) {
  try {
    const config = this.parseCodeBlockConfig(source);
    const data = await this.fetchSpotifyData(config);
    this.renderSpotifyData(el, data, config);
  } catch (error) {
    this.renderError(el, error.message);
  }
}

/**
 * Process spotify-search code blocks
 * Creates interactive search interface
 */
async processSpotifySearchCodeBlock(source, el, ctx) {
  try {
    const config = this.parseSearchCodeBlockConfig(source);
    this.renderSearchInterface(el, config);
  } catch (error) {
    this.renderError(el, error.message);
  }
}

/**
 * Process spotify-user code blocks
 * Displays user stats, top tracks, top artists
 */
async processSpotifyUserCodeBlock(source, el, ctx) {
  try {
    const config = this.parseUserCodeBlockConfig(source);
    const data = await this.fetchSpotifyData(config);
    this.renderUserData(el, data, config);
  } catch (error) {
    this.renderError(el, error.message);
  }
}

/**
 * Parse configuration from main spotify code blocks
 */
parseCodeBlockConfig(source) {
  const config = {};
  const lines = source.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    const [key, value] = line.split(':').map(s => s.trim());
    if (key && value) {
      config[key] = value;
    }
  }
  
  // Validate required fields
  if (!config.type) {
    throw new Error('Type is required (track, album, artist, playlist)');
  }
  
  if (!config.id && !config.url) {
    throw new Error('Either id or url is required');
  }
  
  // Extract ID from URL if provided
  if (config.url && !config.id) {
    config.id = this.extractIdFromUrl(config.url);
  }
  
  // Set defaults
  config.layout = config.layout || this.settings.defaultLayout;
  config.showDetails = config.showDetails !== 'false';
  config.showPreview = config.showPreview !== 'false';
  
  return config;
}

/**
 * Parse configuration from spotify-search code blocks
 */
parseSearchCodeBlockConfig(source) {
  const config = { type: 'search' };
  const lines = source.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    const [key, value] = line.split(':').map(s => s.trim());
    if (key && value) {
      config[key] = value;
    }
  }
  
  // Set defaults
  config.searchType = config.searchType || 'track';
  config.layout = config.layout || this.settings.defaultLayout;
  config.limit = parseInt(config.limit) || 20;
  config.market = config.market || 'US';
  
  return config;
}

/**
 * Parse configuration from spotify-user code blocks
 */
parseUserCodeBlockConfig(source) {
  const config = { type: 'user' };
  const lines = source.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    const [key, value] = line.split(':').map(s => s.trim());
    if (key && value) {
      config[key] = value;
    }
  }
  
  // Set defaults
  config.dataType = config.dataType || 'profile';
  config.timeRange = config.timeRange || 'medium_term';
  config.layout = config.layout || this.settings.defaultLayout;
  config.limit = parseInt(config.limit) || 20;
  
  return config;
}

/**
 * Process inline Spotify links in markdown
 */
async processInlineLinks(el, ctx) {
  const inlineLinks = el.querySelectorAll('a[href^="spotify:"]');
  
  for (const link of inlineLinks) {
    const href = link.getAttribute('href');
    try {
      const config = this.parseInlineLink(href);
      const data = await this.fetchSpotifyData(config);
      
      const container = document.createElement('div');
      container.className = 'spotify-inline-container';
      this.renderSpotifyData(container, data, config);
      
      link.parentNode.replaceChild(container, link);
    } catch (error) {
      this.renderError(link, error.message);
    }
  }
}

/**
 * Parse inline Spotify links
 * Format: spotify:track:ID, spotify:album:ID, etc.
 */
parseInlineLink(href) {
  const parts = href.replace('spotify:', '').split(':');
  
  if (parts.length !== 2) {
    throw new Error('Invalid Spotify link format. Expected: spotify:type:id');
  }
  
  const [type, id] = parts;
  
  if (!['track', 'album', 'artist', 'playlist'].includes(type)) {
    throw new Error(`Unsupported Spotify type: ${type}`);
  }
  
  return {
    type: type,
    id: id,
    layout: 'inline',
    showDetails: true,
    showPreview: false
  };
}

/**
 * Extract Spotify ID from various URL formats
 */
extractIdFromUrl(url) {
  // Handle different Spotify URL formats
  const patterns = [
    /spotify\.com\/track\/([a-zA-Z0-9]+)/,
    /spotify\.com\/album\/([a-zA-Z0-9]+)/,
    /spotify\.com\/artist\/([a-zA-Z0-9]+)/,
    /spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
    /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/,
    /open\.spotify\.com\/album\/([a-zA-Z0-9]+)/,
    /open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/,
    /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  throw new Error('Could not extract ID from Spotify URL');
}

/**
 * Main rendering dispatcher
 */
renderSpotifyData(el, data, config) {
  el.empty();
  el.className = 'spotify-container';
  
  switch (config.type) {
    case 'track':
      this.renderTrack(el, data, config);
      break;
    case 'album':
      this.renderAlbum(el, data, config);
      break;
    case 'artist':
      this.renderArtist(el, data, config);
      break;
    case 'playlist':
      this.renderPlaylist(el, data, config);
      break;
    default:
      this.renderError(el, `Unsupported type: ${config.type}`);
  }
}

/**
 * Render user data (profile, top tracks, top artists)
 */
renderUserData(el, data, config) {
  el.empty();
  el.className = 'spotify-user-container';
  
  switch (config.dataType) {
    case 'profile':
      this.renderUserProfile(el, data);
      break;
    case 'top-tracks':
      this.renderTopTracks(el, data, config);
      break;
    case 'top-artists':
      this.renderTopArtists(el, data, config);
      break;
    default:
      this.renderError(el, `Unsupported user data type: ${config.dataType}`);
  }
}

/**
 * Render interactive search interface
 */
renderSearchInterface(el, config) {
  el.empty();
  el.className = 'spotify-search-container';
  
  // Create search input container
  const searchDiv = document.createElement('div');
  searchDiv.className = 'spotify-search-input-container';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'spotify-search-input';
  searchInput.placeholder = `Search ${config.searchType}s...`;
  
  // Create search type selector
  const typeSelect = document.createElement('select');
  typeSelect.className = 'spotify-search-type';
  
  const types = ['track', 'album', 'artist', 'playlist'];
  types.forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    option.selected = type === config.searchType;
    typeSelect.appendChild(option);
  });
  
  searchDiv.appendChild(searchInput);
  searchDiv.appendChild(typeSelect);
  el.appendChild(searchDiv);
  
  // Create results container
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'spotify-search-results';
  el.appendChild(resultsDiv);
  
  // Add event listeners
  let searchTimeout;
  
  const performSearch = async () => {
    const searchTerm = searchInput.value.trim();
    const searchType = typeSelect.value;
    
    if (searchTerm.length < 2) {
      resultsDiv.innerHTML = '<div class="spotify-search-message">Type at least 2 characters to search...</div>';
      return;
    }
    
    try {
      resultsDiv.innerHTML = '<div class="spotify-search-loading">Searching...</div>';
      
      const searchConfig = {
        type: 'search',
        query: searchTerm,
        searchType: searchType,
        limit: config.limit,
        market: config.market
      };
      
      const data = await this.fetchSpotifyData(searchConfig);
      this.renderSearchResults(resultsDiv, data, searchConfig);
      
    } catch (error) {
      this.renderError(resultsDiv, error.message);
    }
  };
  
  // Debounced search on input
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
  });
  
  // Search on Enter key
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  
  // Search on type change
  typeSelect.addEventListener('change', () => {
    if (searchInput.value.trim().length >= 2) {
      performSearch();
    }
  });
}

/**
 * Render search results
 */
renderSearchResults(el, data, config) {
  el.empty();
  
  const items = data[config.searchType + 's']?.items || [];
  
  if (items.length === 0) {
    el.innerHTML = '<div class="spotify-search-message">No results found.</div>';
    return;
  }
  
  const gridDiv = document.createElement('div');
  gridDiv.className = 'spotify-search-grid';
  gridDiv.style.setProperty('--spotify-grid-columns', this.settings.gridColumns);
  
  items.forEach(item => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'spotify-search-card';
    
    // Add click handler to insert into document
    cardDiv.addEventListener('click', () => {
      this.insertSpotifyBlock(item, config.searchType);
    });
    
    this.renderSearchCard(cardDiv, item, config.searchType);
    gridDiv.appendChild(cardDiv);
  });
  
  el.appendChild(gridDiv);
}

/**
 * Render individual search result card
 */
renderSearchCard(el, item, type) {
  // Image
  const imageUrl = this.getImageUrl(item);
  if (imageUrl && this.settings.showImages) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = item.name;
    img.className = 'spotify-search-image';
    el.appendChild(img);
  }
  
  // Content
  const contentDiv = document.createElement('div');
  contentDiv.className = 'spotify-search-content';
  
  const title = document.createElement('h4');
  title.className = 'spotify-search-title';
  title.textContent = item.name;
  contentDiv.appendChild(title);
  
  // Type-specific information
  if (type === 'track') {
    const artist = document.createElement('p');
    artist.className = 'spotify-search-artist';
    artist.textContent = item.artists.map(a => a.name).join(', ');
    contentDiv.appendChild(artist);
    
    if (item.album) {
      const album = document.createElement('p');
      album.className = 'spotify-search-album';
      album.textContent = item.album.name;
      contentDiv.appendChild(album);
    }
  } else if (type === 'album') {
    const artist = document.createElement('p');
    artist.className = 'spotify-search-artist';
    artist.textContent = item.artists.map(a => a.name).join(', ');
    contentDiv.appendChild(artist);
    
    const year = document.createElement('p');
    year.className = 'spotify-search-year';
    year.textContent = item.release_date ? new Date(item.release_date).getFullYear() : '';
    contentDiv.appendChild(year);
  } else if (type === 'artist') {
    const followers = document.createElement('p');
    followers.className = 'spotify-search-followers';
    followers.textContent = `${item.followers.total.toLocaleString()} followers`;
    contentDiv.appendChild(followers);
  } else if (type === 'playlist') {
    const owner = document.createElement('p');
    owner.className = 'spotify-search-owner';
    owner.textContent = `by ${item.owner.display_name}`;
    contentDiv.appendChild(owner);
    
    const tracks = document.createElement('p');
    tracks.className = 'spotify-search-tracks';
    tracks.textContent = `${item.tracks.total} tracks`;
    contentDiv.appendChild(tracks);
  }
  
  el.appendChild(contentDiv);
}

/**
 * Insert Spotify code block into the current document
 */
insertSpotifyBlock(item, type) {
  const activeLeaf = this.app.workspace.activeLeaf;
  if (!activeLeaf) return;
  
  const view = activeLeaf.view;
  if (view.getViewType() !== 'markdown') return;
  
  const editor = view.editor;
  const codeBlock = `\`\`\`spotify
type: ${type}
id: ${item.id}
layout: card
\`\`\``;
  
  editor.replaceSelection(codeBlock);
}

/**
 * Get image URL from various Spotify objects
 */
getImageUrl(item) {
  if (item.images && item.images.length > 0) {
    return item.images[0].url;
  }
  if (item.album && item.album.images && item.album.images.length > 0) {
    return item.album.images[0].url;
  }
  return null;
}

/**
 * Render error messages
 */
renderError(el, message) {
  el.innerHTML = `<div class="spotify-error">
    <span class="spotify-error-icon">⚠️</span>
    <span class="spotify-error-message">Error: ${message}</span>
  </div>`;
}

/**
 * Validate code block configuration
 */
validateConfig(config) {
  const validTypes = ['track', 'album', 'artist', 'playlist', 'search', 'user'];
  
  if (!config.type) {
    throw new Error('Configuration must specify a type');
  }
  
  if (!validTypes.includes(config.type)) {
    throw new Error(`Invalid type: ${config.type}. Must be one of: ${validTypes.join(', ')}`);
  }
  
  if (config.type !== 'search' && config.type !== 'user' && !config.id) {
    throw new Error('Configuration must specify an id for this type');
  }
  
  return true;
    }


// Part 4: Rendering Methods for Individual Content Types
// Add these methods to your SpotifyPlugin class

/**
 * Render a single track
 */
renderTrack(el, track, config) {
  const trackDiv = document.createElement('div');
  trackDiv.className = `spotify-track spotify-${config.layout}`;
  
  if (config.layout === 'card') {
    this.renderTrackCard(trackDiv, track, config);
  } else if (config.layout === 'inline') {
    this.renderTrackInline(trackDiv, track, config);
  } else {
    this.renderTrackTable(trackDiv, track, config);
  }
  
  el.appendChild(trackDiv);
}

/**
 * Render track as card
 */
renderTrackCard(el, track, config) {
  // Album artwork
  if (track.album.images && track.album.images.length > 0 && this.settings.showAlbumArt) {
    const img = document.createElement('img');
    img.src = track.album.images[0].url;
    img.alt = track.name;
    img.className = 'spotify-track-image';
    el.appendChild(img);
  }
  
  // Content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'spotify-track-content';
  
  // Track name
  const titleDiv = document.createElement('div');
  titleDiv.className = 'spotify-track-title';
  
  const titleLink = document.createElement('a');
  titleLink.href = track.external_urls.spotify;
  titleLink.textContent = track.name;
  titleLink.target = '_blank';
  titleDiv.appendChild(titleLink);
  
  if (track.explicit) {
    const explicitBadge = document.createElement('span');
    explicitBadge.className = 'spotify-explicit-badge';
    explicitBadge.textContent = 'E';
    titleDiv.appendChild(explicitBadge);
  }
  
  contentDiv.appendChild(titleDiv);
  
  // Artist
  if (this.settings.showArtist) {
    const artistDiv = document.createElement('div');
    artistDiv.className = 'spotify-track-artist';
    artistDiv.textContent = track.artists.map(a => a.name).join(', ');
    contentDiv.appendChild(artistDiv);
  }
  
  // Album
  if (this.settings.showAlbum) {
    const albumDiv = document.createElement('div');
    albumDiv.className = 'spotify-track-album';
    albumDiv.textContent = track.album.name;
    contentDiv.appendChild(albumDiv);
  }
  
  // Duration
  if (this.settings.showDuration) {
    const durationDiv = document.createElement('div');
    durationDiv.className = 'spotify-track-duration';
    durationDiv.textContent = this.formatDuration(track.duration_ms);
    contentDiv.appendChild(durationDiv);
  }
  
  // Popularity
  if (this.settings.showPopularity) {
    const popularityDiv = document.createElement('div');
    popularityDiv.className = 'spotify-track-popularity';
    popularityDiv.textContent = `${track.popularity}% popularity`;
    contentDiv.appendChild(popularityDiv);
  }
  
  // Preview player
  if (track.preview_url && config.showPreview) {
    const audioDiv = document.createElement('div');
    audioDiv.className = 'spotify-track-preview';
    
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = track.preview_url;
    audio.preload = 'none';
    
    audioDiv.appendChild(audio);
    contentDiv.appendChild(audioDiv);
  }
  
  el.appendChild(contentDiv);
}

/**
 * Render track inline
 */
renderTrackInline(el, track, config) {
  el.className = 'spotify-track-inline';
  
  // Small album art
  if (track.album.images && track.album.images.length > 0 && this.settings.showAlbumArt) {
    const img = document.createElement('img');
    img.src = track.album.images[0].url;
    img.alt = track.name;
    img.className = 'spotify-track-inline-image';
    el.appendChild(img);
  }
  
  // Track info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'spotify-track-inline-info';
  
  const titleSpan = document.createElement('span');
  titleSpan.className = 'spotify-track-inline-title';
  titleSpan.textContent = track.name;
  infoDiv.appendChild(titleSpan);
  
  if (this.settings.showArtist) {
    const artistSpan = document.createElement('span');
    artistSpan.className = 'spotify-track-inline-artist';
    artistSpan.textContent = ` by ${track.artists.map(a => a.name).join(', ')}`;
    infoDiv.appendChild(artistSpan);
  }
  
  el.appendChild(infoDiv);
  
  // Open in Spotify link
  const linkDiv = document.createElement('div');
  linkDiv.className = 'spotify-track-inline-link';
  
  const link = document.createElement('a');
  link.href = track.external_urls.spotify;
  link.textContent = '♪ Open in Spotify';
  link.target = '_blank';
  linkDiv.appendChild(link);
  
  el.appendChild(linkDiv);
}

/**
 * Render album
 */
renderAlbum(el, album, config) {
  const albumDiv = document.createElement('div');
  albumDiv.className = `spotify-album spotify-${config.layout}`;
  
  // Album header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'spotify-album-header';
  
  // Album artwork
  if (album.images && album.images.length > 0 && this.settings.showAlbumArt) {
    const img = document.createElement('img');
    img.src = album.images[0].url;
    img.alt = album.name;
    img.className = 'spotify-album-image';
    headerDiv.appendChild(img);
  }
  
  // Album info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'spotify-album-info';
  
  const titleLink = document.createElement('a');
  titleLink.href = album.external_urls.spotify;
  titleLink.textContent = album.name;
  titleLink.target = '_blank';
  titleLink.className = 'spotify-album-title';
  infoDiv.appendChild(titleLink);
  
  if (this.settings.showArtist) {
    const artistDiv = document.createElement('div');
    artistDiv.className = 'spotify-album-artist';
    artistDiv.textContent = album.artists.map(a => a.name).join(', ');
    infoDiv.appendChild(artistDiv);
  }
  
  const metaDiv = document.createElement('div');
  metaDiv.className = 'spotify-album-meta';
  
  if (album.release_date) {
    const yearSpan = document.createElement('span');
    yearSpan.textContent = new Date(album.release_date).getFullYear();
    metaDiv.appendChild(yearSpan);
  }
  
  const tracksSpan = document.createElement('span');
  tracksSpan.textContent = `${album.total_tracks} tracks`;
  metaDiv.appendChild(tracksSpan);
  
  infoDiv.appendChild(metaDiv);
  headerDiv.appendChild(infoDiv);
  albumDiv.appendChild(headerDiv);
  
  // Track listing
  if (album.tracks && album.tracks.items && config.showDetails !== false) {
    const tracksDiv = document.createElement('div');
    tracksDiv.className = 'spotify-album-tracks';
    
    const tracksTitle = document.createElement('h4');
    tracksTitle.textContent = 'Tracks';
    tracksDiv.appendChild(tracksTitle);
    
    const tracksList = document.createElement('div');
    tracksList.className = 'spotify-tracks-list';
    
    album.tracks.items.forEach((track, index) => {
      const trackDiv = document.createElement('div');
      trackDiv.className = 'spotify-track-item';
      
      const numberSpan = document.createElement('span');
      numberSpan.className = 'spotify-track-number';
      numberSpan.textContent = index + 1;
      trackDiv.appendChild(numberSpan);
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'spotify-track-name';
      nameSpan.textContent = track.name;
      trackDiv.appendChild(nameSpan);
      
      if (this.settings.showDuration) {
        const durationSpan = document.createElement('span');
        durationSpan.className = 'spotify-track-duration';
        durationSpan.textContent = this.formatDuration(track.duration_ms);
        trackDiv.appendChild(durationSpan);
      }
      
      tracksList.appendChild(trackDiv);
    });
    
    tracksDiv.appendChild(tracksList);
    albumDiv.appendChild(tracksDiv);
  }
  
  el.appendChild(albumDiv);
}

/**
 * Render artist
 */
renderArtist(el, artist, config) {
  const artistDiv = document.createElement('div');
  artistDiv.className = `spotify-artist spotify-${config.layout}`;
  
  // Artist header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'spotify-artist-header';
  
  // Artist image
  if (artist.images && artist.images.length > 0 && this.settings.showAlbumArt) {
    const img = document.createElement('img');
    img.src = artist.images[0].url;
    img.alt = artist.name;
    img.className = 'spotify-artist-image';
    headerDiv.appendChild(img);
  }
  
  // Artist info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'spotify-artist-info';
  
  const titleLink = document.createElement('a');
  titleLink.href = artist.external_urls.spotify;
  titleLink.textContent = artist.name;
  titleLink.target = '_blank';
  titleLink.className = 'spotify-artist-title';
  infoDiv.appendChild(titleLink);
  
  // Followers
  const followersDiv = document.createElement('div');
  followersDiv.className = 'spotify-artist-followers';
  followersDiv.textContent = `${artist.followers.total.toLocaleString()} followers`;
  infoDiv.appendChild(followersDiv);
  
  // Genres
  if (this.settings.showGenres && artist.genres && artist.genres.length > 0) {
    const genresDiv = document.createElement('div');
    genresDiv.className = 'spotify-artist-genres';
    genresDiv.textContent = artist.genres.join(', ');
    infoDiv.appendChild(genresDiv);
  }
  
  // Popularity
  if (this.settings.showPopularity) {
    const popularityDiv = document.createElement('div');
    popularityDiv.className = 'spotify-artist-popularity';
    popularityDiv.textContent = `${artist.popularity}% popularity`;
    infoDiv.appendChild(popularityDiv);
  }
  
  headerDiv.appendChild(infoDiv);
  artistDiv.appendChild(headerDiv);
  
  // Top tracks
  if (artist.topTracks && artist.topTracks.length > 0 && config.showDetails !== false) {
    const topTracksDiv = document.createElement('div');
    topTracksDiv.className = 'spotify-artist-top-tracks';
    
    const tracksTitle = document.createElement('h4');
    tracksTitle.textContent = 'Top Tracks';
    topTracksDiv.appendChild(tracksTitle);
    
    const tracksList = document.createElement('div');
    tracksList.className = 'spotify-tracks-list';
    
    artist.topTracks.slice(0, 10).forEach((track, index) => {
      const trackDiv = document.createElement('div');
      trackDiv.className = 'spotify-track-item';
      
      const numberSpan = document.createElement('span');
      numberSpan.className = 'spotify-track-number';
      numberSpan.textContent = index + 1;
      trackDiv.appendChild(numberSpan);
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'spotify-track-name';
      nameSpan.textContent = track.name;
      trackDiv.appendChild(nameSpan);
      
      if (this.settings.showDuration) {
        const durationSpan = document.createElement('span');
        durationSpan.className = 'spotify-track-duration';
        durationSpan.textContent = this.formatDuration(track.duration_ms);
        trackDiv.appendChild(durationSpan);
      }
      
      tracksList.appendChild(trackDiv);
    });
    
    topTracksDiv.appendChild(tracksList);
    artistDiv.appendChild(topTracksDiv);
  }
  
  // Albums
  if (artist.albums && artist.albums.length > 0 && config.showDetails !== false) {
    const albumsDiv = document.createElement('div');
    albumsDiv.className = 'spotify-artist-albums';
    
    const albumsTitle = document.createElement('h4');
    albumsTitle.textContent = 'Albums';
    albumsDiv.appendChild(albumsTitle);
    
    const albumsGrid = document.createElement('div');
    albumsGrid.className = 'spotify-albums-grid';
    
    artist.albums.slice(0, 8).forEach(album => {
      const albumDiv = document.createElement('div');
      albumDiv.className = 'spotify-album-item';
      
      if (album.images && album.images.length > 0) {
        const img = document.createElement('img');
        img.src = album.images[0].url;
        img.alt = album.name;
        img.className = 'spotify-album-item-image';
        albumDiv.appendChild(img);
      }
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'spotify-album-item-name';
      nameDiv.textContent = album.name;
      albumDiv.appendChild(nameDiv);
      
      const yearDiv = document.createElement('div');
      yearDiv.className = 'spotify-album-item-year';
      yearDiv.textContent = album.release_date ? new Date(album.release_date).getFullYear() : '';
      albumDiv.appendChild(yearDiv);
      
      albumsGrid.appendChild(albumDiv);
    });
    
    albumsDiv.appendChild(albumsGrid);
    artistDiv.appendChild(albumsDiv);
  }
  
  el.appendChild(artistDiv);
}

/**
 * Render playlist
 */
renderPlaylist(el, playlist, config) {
  const playlistDiv = document.createElement('div');
  playlistDiv.className = `spotify-playlist spotify-${config.layout}`;
  
  // Playlist header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'spotify-playlist-header';
  
  // Playlist image
  if (playlist.images && playlist.images.length > 0 && this.settings.showAlbumArt) {
    const img = document.createElement('img');
    img.src = playlist.images[0].url;
    img.alt = playlist.name;
    img.className = 'spotify-playlist-image';
    headerDiv.appendChild(img);
  }
  
  // Playlist info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'spotify-playlist-info';
  
  const titleLink = document.createElement('a');
  titleLink.href = playlist.external_urls.spotify;
  titleLink.textContent = playlist.name;
  titleLink.target = '_blank';
  titleLink.className = 'spotify-playlist-title';
  infoDiv.appendChild(titleLink);
  
  if (playlist.description) {
    const descDiv = document.createElement('div');
    descDiv.className = 'spotify-playlist-description';
    descDiv.textContent = playlist.description;
    infoDiv.appendChild(descDiv);
  }
  
  const metaDiv = document.createElement('div');
  metaDiv.className = 'spotify-playlist-meta';
  
  const ownerSpan = document.createElement('span');
  ownerSpan.textContent = `by ${playlist.owner.display_name}`;
  metaDiv.appendChild(ownerSpan);
  
  const tracksSpan = document.createElement('span');
  tracksSpan.textContent = `${playlist.tracks.total} tracks`;
  metaDiv.appendChild(tracksSpan);
  
  infoDiv.appendChild(metaDiv);
  headerDiv.appendChild(infoDiv);
  playlistDiv.appendChild(headerDiv);
  
  // Track listing
  if (playlist.tracks && playlist.tracks.items && config.showDetails !== false) {
    const tracksDiv = document.createElement('div');
    tracksDiv.className = 'spotify-playlist-tracks';
    
    const tracksTitle = document.createElement('h4');
    tracksTitle.textContent = 'Tracks';
    tracksDiv.appendChild(tracksTitle);
    
    const tracksList = document.createElement('div');
    tracksList.className = 'spotify-tracks-list';
    
    const tracksToShow = playlist.tracks.items.slice(0, 20);
    
    tracksToShow.forEach((item, index) => {
      if (!item.track) return;
      
      const trackDiv = document.createElement('div');
      trackDiv.className = 'spotify-track-item';
      
      const numberSpan = document.createElement('span');
      numberSpan.className = 'spotify-track-number';
      numberSpan.textContent = index + 1;
      trackDiv.appendChild(numberSpan);
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'spotify-track-name';
      nameSpan.textContent = item.track.name;
      trackDiv.appendChild(nameSpan);
      
      if (this.settings.showArtist) {
        const artistSpan = document.createElement('span');
        artistSpan.className = 'spotify-track-artist';
        artistSpan.textContent = item.track.artists.map(a => a.name).join(', ');
        trackDiv.appendChild(artistSpan);
      }
      
      if (this.settings.showDuration) {
        const durationSpan = document.createElement('span');
        durationSpan.className = 'spotify-track-duration';
        durationSpan.textContent = this.formatDuration(item.track.duration_ms);
        trackDiv.appendChild(durationSpan);
      }
      
      tracksList.appendChild(trackDiv);
    });
    
    tracksDiv.appendChild(tracksList);
    playlistDiv.appendChild(tracksDiv);
  }
  
  el.appendChild(playlistDiv);
}

/**
 * Render user profile
 */
renderUserProfile(el, user) {
  const userDiv = document.createElement('div');
  userDiv.className = 'spotify-user-profile';
  
  // User image
  if (user.images && user.images.length > 0) {
    const img = document.createElement('img');
    img.src = user.images[0].url;
    img.alt = user.display_name;
    img.className = 'spotify-user-image';
    userDiv.appendChild(img);
  }
  
  // User info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'spotify-user-info';
  
  const nameDiv = document.createElement('div');
  nameDiv.className = 'spotify-user-name';
  nameDiv.textContent = user.display_name;
  infoDiv.appendChild(nameDiv);
  
  const followersDiv = document.createElement('div');
  followersDiv.className = 'spotify-user-followers';
  followersDiv.textContent = `${user.followers.total.toLocaleString()} followers`;
  infoDiv.appendChild(followersDiv);
  
  const countryDiv = document.createElement('div');
  countryDiv.className = 'spotify-user-country';
  countryDiv.textContent = user.country;
  infoDiv.appendChild(countryDiv);
  
  userDiv.appendChild(infoDiv);
  el.appendChild(userDiv);
}

/**
 * Render top tracks
 */
renderTopTracks(el, data, config) {
  const tracksDiv = document.createElement('div');
  tracksDiv.className = 'spotify-top-tracks';
  
  const title = document.createElement('h3');
  title.textContent = 'Top Tracks';
  tracksDiv.appendChild(title);
  
  const tracksList = document.createElement('div');
  tracksList.className = 'spotify-tracks-list';
  
  data.items.forEach((track, index) => {
    const trackDiv = document.createElement('div');
    trackDiv.className = 'spotify-track-item';
    
    const numberSpan = document.createElement('span');
    numberSpan.className = 'spotify-track-number';
    numberSpan.textContent = index + 1;
    trackDiv.appendChild(numberSpan);
    
    if (track.album.images && track.album.images.length > 0) {
      const img = document.createElement('img');
      img.src = track.album.images[0].url;
      img.alt = track.name;
      img.className = 'spotify-track-mini-image';
      trackDiv.appendChild(img);
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'spotify-track-name';
    nameSpan.textContent = track.name;
    trackDiv.appendChild(nameSpan);
    
    const artistSpan = document.createElement('span');
    artistSpan.className = 'spotify-track-artist';
    artistSpan.textContent = track.artists.map(a => a.name).join(', ');
    trackDiv.appendChild(artistSpan);
    
    tracksList.appendChild(trackDiv);
  });
  
  tracksDiv.appendChild(tracksList);
  el.appendChild(tracksDiv);
}

/**
 * Render top artists
 */
renderTopArtists(el, data, config) {
  const artistsDiv = document.createElement('div');
  artistsDiv.className = 'spotify-top-artists';
  
  const title = document.createElement('h3');
  title.textContent = 'Top Artists';
  artistsDiv.appendChild(title);
  
  const artistsGrid = document.createElement('div');
  artistsGrid.className = 'spotify-artists-grid';
  
  data.items.forEach((artist, index) => {
    const artistDiv = document.createElement('div');
    artistDiv.className = 'spotify-artist-item';
    
    if (artist.images && artist.images.length > 0) {
      const img = document.createElement('img');
      img.src = artist.images[0].url;
      img.alt = artist.name;
      img.className = 'spotify-artist-item-image';
      artistDiv.appendChild(img);
    }
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'spotify-artist-item-name';
    nameDiv.textContent = artist.name;
    artistDiv.appendChild(nameDiv);
    
    const rankDiv = document.createElement('div');
    rankDiv.className = 'spotify-artist-item-rank';
    rankDiv.textContent = `#${index + 1}`;
    artistDiv.appendChild(rankDiv);
    
    artistsGrid.appendChild(artistDiv);
  });
  
  artistsDiv.appendChild(artistsGrid);
  el.appendChild(artistsDiv);
}
