const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

/**
 * Spotify Obsidian Plugin
 */
class SpotifyPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000;
    this.accessToken = null;
    this.tokenExpiry = null;
    this.settings = {};
  }

  async onload() {
    console.log('Loading Spotify Plugin');
    await this.loadSettings();
    this.registerCodeBlockProcessors();
    this.addSettingTab(new SpotifySettingTab(this.app, this));
    if (this.settings.clientId && this.settings.clientSecret) {
      await this.authenticateSpotify();
    }
  }

  onunload() {
    console.log('Unloading Spotify Plugin');
  }

  // ===================== SETTINGS =====================
async loadSettings() {
  const defaults = { 
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
    maxResults: 20,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null };
  
  const loaded = await this.loadData();
  this.settings = Object.assign({}, defaults, loaded);
  
  // Validate numeric settings
  this.settings.gridColumns = Math.max(1, Math.min(this.settings.gridColumns, 5));
  this.settings.maxResults = Math.max(5, Math.min(this.settings.maxResults, 50));
  this.settings.cacheTimeout = Math.max(60000, this.settings.cacheTimeout || 5 * 60 * 1000);
  
  // Validate layout setting
  if (!['card', 'list', 'grid', 'inline'].includes(this.settings.defaultLayout)) {
    this.settings.defaultLayout = 'card';
  }
}

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ===================== SPOTIFY AUTH =====================
async authenticateSpotify() {
  if (!this.settings.clientId || !this.settings.clientSecret) {
    throw new Error('Client ID and Client Secret are required');
  }
  
  if (!this.settings.clientId.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error('Invalid Client ID format');
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(this.settings.clientId + ':' + this.settings.clientSecret)
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Authentication failed: ${response.status} - ${errorData.error_description || response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    
    console.log('Spotify authentication successful');
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Authentication request timed out');
    }
    console.error('Spotify authentication error:', error);
    this.accessToken = null;
    this.tokenExpiry = null;
    throw error;
  }
}
  

  async getValidAccessToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.authenticateSpotify();
    }
    return this.accessToken;
  }

  // ===================== CODE BLOCK REGISTRATION =====================

  registerCodeBlockProcessors() {
    this.registerMarkdownCodeBlockProcessor('spotify', this.processSpotifyCodeBlock.bind(this));
    this.registerMarkdownCodeBlockProcessor('spotify-search', this.processSpotifySearchCodeBlock.bind(this));
    this.registerMarkdownPostProcessor(this.processInlineLinks.bind(this));
  }

  // ===================== CODE BLOCK PROCESSORS =====================

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

  // ===================== PARSERS =====================

  parseCodeBlockConfig(source) {
    const config = {};
    const lines = source.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) config[key] = value;
    }
    config.type = config.type || 'playlist';
    config.id = config.id || (config.url ? this.extractIdFromUrl(config.url) : undefined);
    config.layout = config.layout || this.settings.defaultLayout;
    config.limit = parseInt(config.limit) || this.settings.maxResults;
    if (!config.id) throw new Error('No Spotify ID given');
    return config;
  }

  parseSearchCodeBlockConfig(source) {
    const config = { type: 'search' };
    const lines = source.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key && value) config[key] = value;
    }
    config.searchType = config.searchType || 'track';
    config.layout = config.layout || this.settings.defaultLayout;
    config.limit = parseInt(config.limit) || this.settings.maxResults;
    return config;
  }

  parseInlineLink(href) {
    const parts = href.replace('spotify:', '').split(':');
    if (parts.length !== 2) throw new Error('Invalid Spotify link format. Expected: spotify:type:id');
    const [type, id] = parts;
    return { type, id, layout: 'inline' };
  }

  extractIdFromUrl(url) {
    const patterns = [
      /spotify\.com\/track\/([a-zA-Z0-9]+)/,
      /spotify\.com\/album\/([a-zA-Z0-9]+)/,
      /spotify\.com\/artist\/([a-zA-Z0-9]+)/,
      /spotify\.com\/playlist\/([a-zA-Z0-9]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    throw new Error('Could not extract ID from Spotify URL');
  }

  // ===================== DATA FETCHING =====================

  async fetchSpotifyData(config) {
    const cacheKey = JSON.stringify(config);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    let data;
    try {
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
        default:
          throw new Error(`Unknown data type: ${config.type}`);
      }

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('Error fetching Spotify data:', error);
      throw error;
    }
  }

  async fetchTrack(id) {
    return await this.makeSpotifyRequest(`/tracks/${id}`);
  }

  async fetchAlbum(id) {
    const [album, tracks] = await Promise.all([
      this.makeSpotifyRequest(`/albums/${id}`),
      this.makeSpotifyRequest(`/albums/${id}/tracks?limit=50`)
    ]);
    album.tracks = { items: tracks.items };
    return album;
  }

  async fetchArtist(id) {
    const [artist, topTracks, albums] = await Promise.all([
      this.makeSpotifyRequest(`/artists/${id}`),
      this.makeSpotifyRequest(`/artists/${id}/top-tracks?market=US`),
      this.makeSpotifyRequest(`/artists/${id}/albums?include_groups=album,single&market=US&limit=20`)
    ]);
    artist.topTracks = topTracks.tracks;
    artist.albums = albums.items;
    return artist;
  }

  async fetchPlaylist(id) {
    return await this.makeSpotifyRequest(`/playlists/${id}`);
  }

  async searchSpotify(query, type = 'track', limit = 20) {
    const encodedQuery = encodeURIComponent(query);
    return await this.makeSpotifyRequest(`/search?q=${encodedQuery}&type=${type}&limit=${limit}`);
  }

 async makeSpotifyRequest(endpoint, method = 'GET', body = null) {
  try {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) {
      throw new Error('No valid access token available');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const options = { 
      method, 
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal 
    };
    
    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, options);
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Spotify API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }
    
    if (response.status === 204) return null;
    return await response.json();
    
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

  // ===================== UTILITY METHODS =====================

  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  emptyElement(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  // ===================== RENDERING =====================
// ===================== FIXED RENDERING METHODS =====================

renderSpotifyData(el, data, config) {
  this.emptyElement(el);
  const layout = config.layout || this.settings.defaultLayout;
  el.className = `spotify-container spotify-layout-${layout}`;
  
  // Apply grid columns if using grid layout
  if (layout === 'grid') {
    el.style.setProperty('--grid-columns', this.settings.gridColumns);
  }
  
  try {
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
  } catch (error) {
    this.renderError(el, `Rendering error: ${error.message}`);
  }
}

renderTrack(el, track, config) {
  const layout = config.layout || this.settings.defaultLayout;
  
  const trackEl = document.createElement('div');
  trackEl.className = `spotify-track spotify-${layout}`;
  
  // Layout-specific styling
  if (layout === 'inline') {
    trackEl.style.display = 'inline-flex';
    trackEl.style.alignItems = 'center';
    trackEl.style.gap = '8px';
  } else if (layout === 'list') {
    trackEl.style.display = 'flex';
    trackEl.style.alignItems = 'center';
    trackEl.style.gap = '12px';
    trackEl.style.padding = '8px';
    trackEl.style.borderBottom = '1px solid var(--background-modifier-border)';
  } else if (layout === 'card' || layout === 'grid') {
    trackEl.style.display = 'flex';
    trackEl.style.flexDirection = 'column';
    trackEl.style.padding = '12px';
    trackEl.style.border = '1px solid var(--background-modifier-border)';
    trackEl.style.borderRadius = '8px';
  }
  
  // Album art
  if (this.settings.showAlbumArt && track.album?.images?.[0]) {
    const img = document.createElement('img');
    img.src = track.album.images[0].url;
    img.className = 'spotify-album-art';
    
    if (layout === 'inline') {
      img.style.width = '32px';
      img.style.height = '32px';
    } else if (layout === 'list') {
      img.style.width = '48px';
      img.style.height = '48px';
    } else {
      img.style.width = '100%';
      img.style.aspectRatio = '1';
      img.style.objectFit = 'cover';
    }
    
    trackEl.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-track-info';
  
  if (layout === 'list') {
    info.style.flex = '1';
    info.style.display = 'flex';
    info.style.alignItems = 'center';
    info.style.gap = '16px';
  } else if (layout === 'inline') {
    info.style.display = 'flex';
    info.style.alignItems = 'center';
    info.style.gap = '8px';
  }
  
  const title = document.createElement('div');
  title.className = 'spotify-track-title';
  title.textContent = track.name;
  title.style.fontWeight = 'bold';
  
  if (layout === 'list') {
    title.style.flex = '1';
  }
  
  info.appendChild(title);
  
  if (this.settings.showArtist) {
    const artist = document.createElement('div');
    artist.className = 'spotify-track-artist';
    artist.textContent = track.artists.map(a => a.name).join(', ');
    artist.style.color = 'var(--text-muted)';
    
    if (layout === 'list') {
      artist.style.flex = '1';
    }
    
    info.appendChild(artist);
  }
  
  if (this.settings.showAlbum && track.album) {
    const album = document.createElement('div');
    album.className = 'spotify-track-album';
    album.textContent = track.album.name;
    album.style.color = 'var(--text-muted)';
    album.style.fontSize = '0.9em';
    
    if (layout === 'list') {
      album.style.flex = '1';
    }
    
    info.appendChild(album);
  }
  
  if (this.settings.showDuration && track.duration_ms) {
    const duration = document.createElement('div');
    duration.className = 'spotify-track-duration';
    duration.textContent = this.formatDuration(track.duration_ms);
    duration.style.color = 'var(--text-muted)';
    duration.style.fontSize = '0.9em';
    
    if (layout === 'list') {
      duration.style.marginLeft = 'auto';
    }
    
    info.appendChild(duration);
  }
  
  if (this.settings.showPopularity && track.popularity) {
    const popularity = document.createElement('div');
    popularity.className = 'spotify-track-popularity';
    popularity.textContent = `${track.popularity}%`;
    popularity.style.color = 'var(--text-muted)';
    popularity.style.fontSize = '0.8em';
    info.appendChild(popularity);
  }
  
  trackEl.appendChild(info);
  
  // Apply grid layout if needed
  if (layout === 'grid') {
    el.style.display = 'grid';
    el.style.gridTemplateColumns = `repeat(${this.settings.gridColumns}, 1fr)`;
    el.style.gap = '16px';
  }
  
  el.appendChild(trackEl);
}

renderAlbum(el, album, config) {
  const layout = config.layout || this.settings.defaultLayout;
  
  const albumEl = document.createElement('div');
  albumEl.className = `spotify-album spotify-${layout}`;
  
  // Layout-specific styling
  if (layout === 'card' || layout === 'grid') {
    albumEl.style.display = 'flex';
    albumEl.style.flexDirection = 'column';
    albumEl.style.padding = '12px';
    albumEl.style.border = '1px solid var(--background-modifier-border)';
    albumEl.style.borderRadius = '8px';
  }
  
  const header = document.createElement('div');
  header.className = 'spotify-album-header';
  header.style.display = 'flex';
  header.style.gap = '12px';
  header.style.alignItems = 'flex-start';
  
  if (this.settings.showAlbumArt && album.images?.[0]) {
    const img = document.createElement('img');
    img.src = album.images[0].url;
    img.className = 'spotify-album-art';
    
    if (layout === 'card' || layout === 'grid') {
      img.style.width = '100%';
      img.style.aspectRatio = '1';
      img.style.objectFit = 'cover';
      img.style.marginBottom = '12px';
    } else {
      img.style.width = '80px';
      img.style.height = '80px';
      img.style.objectFit = 'cover';
    }
    
    header.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-album-info';
  info.style.flex = '1';
  
  const title = document.createElement('h3');
  title.className = 'spotify-album-title';
  title.textContent = album.name;
  title.style.margin = '0 0 8px 0';
  title.style.fontWeight = 'bold';
  info.appendChild(title);
  
  if (this.settings.showArtist) {
    const artist = document.createElement('div');
    artist.className = 'spotify-album-artist';
    artist.textContent = album.artists.map(a => a.name).join(', ');
    artist.style.color = 'var(--text-muted)';
    artist.style.marginBottom = '4px';
    info.appendChild(artist);
  }
  
  const releaseDate = document.createElement('div');
  releaseDate.className = 'spotify-album-release-date';
  releaseDate.textContent = `Released: ${album.release_date}`;
  releaseDate.style.color = 'var(--text-muted)';
  releaseDate.style.fontSize = '0.9em';
  releaseDate.style.marginBottom = '4px';
  info.appendChild(releaseDate);
  
  const trackCount = document.createElement('div');
  trackCount.className = 'spotify-album-track-count';
  trackCount.textContent = `${album.total_tracks} tracks`;
  trackCount.style.color = 'var(--text-muted)';
  trackCount.style.fontSize = '0.9em';
  info.appendChild(trackCount);
  
  header.appendChild(info);
  albumEl.appendChild(header);
  
  // Render tracks if available and not card layout
  if (album.tracks?.items?.length > 0 && layout !== 'card') {
    const tracksList = document.createElement('div');
    tracksList.className = `spotify-album-tracks`;
    tracksList.style.marginTop = '16px';
    
    // Apply max results limit
    const tracksToShow = album.tracks.items.slice(0, this.settings.maxResults);
    
    tracksToShow.forEach((track, index) => {
      const trackItem = document.createElement('div');
      trackItem.className = 'spotify-album-track-item';
      trackItem.style.display = 'flex';
      trackItem.style.alignItems = 'center';
      trackItem.style.padding = '4px 0';
      trackItem.style.borderBottom = '1px solid var(--background-modifier-border-light)';
      
      const trackNumber = document.createElement('div');
      trackNumber.className = 'spotify-track-number';
      trackNumber.textContent = (index + 1).toString();
      trackNumber.style.width = '24px';
      trackNumber.style.color = 'var(--text-muted)';
      trackNumber.style.fontSize = '0.9em';
      trackItem.appendChild(trackNumber);
      
      const trackInfo = document.createElement('div');
      trackInfo.className = 'spotify-track-info';
      trackInfo.style.flex = '1';
      
      const trackTitle = document.createElement('div');
      trackTitle.className = 'spotify-track-title';
      trackTitle.textContent = track.name;
      trackTitle.style.fontWeight = '500';
      trackInfo.appendChild(trackTitle);
      
      const trackArtist = document.createElement('div');
      trackArtist.className = 'spotify-track-artist';
      trackArtist.textContent = track.artists.map(a => a.name).join(', ');
      trackArtist.style.color = 'var(--text-muted)';
      trackArtist.style.fontSize = '0.9em';
      trackInfo.appendChild(trackArtist);
      
      trackItem.appendChild(trackInfo);

      if (this.settings.showDuration && track.duration_ms) {
        const duration = document.createElement('div');
        duration.className = 'spotify-track-duration';
        duration.textContent = this.formatDuration(track.duration_ms);
        duration.style.color = 'var(--text-muted)';
        duration.style.fontSize = '0.9em';
        trackItem.appendChild(duration);
      }
      
      tracksList.appendChild(trackItem);
    });
    
    albumEl.appendChild(tracksList);
  }
  
  // Apply grid layout if needed
  if (layout === 'grid') {
    el.style.display = 'grid';
    el.style.gridTemplateColumns = `repeat(${this.settings.gridColumns}, 1fr)`;
    el.style.gap = '16px';
  }
  
  el.appendChild(albumEl);
}

renderSearchResults(el, results, config) {
  this.emptyElement(el);
  
  const searchType = config.searchType || 'track';
  const items = results[searchType + 's']?.items || [];
  
  if (items.length === 0) {
    const noResults = document.createElement('div');
    noResults.className = 'spotify-no-results';
    noResults.textContent = 'No results found';
    noResults.style.textAlign = 'center';
    noResults.style.padding = '20px';
    noResults.style.color = 'var(--text-muted)';
    el.appendChild(noResults);
    return;
  }
  
  const layout = config.layout || this.settings.defaultLayout;
  
  // Apply max results limit
  const itemsToShow = items.slice(0, config.limit || this.settings.maxResults);
  
  // Set up grid layout if needed
  if (layout === 'grid') {
    el.style.display = 'grid';
    el.style.gridTemplateColumns = `repeat(${this.settings.gridColumns}, 1fr)`;
    el.style.gap = '16px';
  }
  
  itemsToShow.forEach(item => {
    const itemContainer = document.createElement('div');
    itemContainer.className = `spotify-search-result-item spotify-${layout}`;
    
    // Layout-specific styling
    if (layout === 'list') {
      itemContainer.style.display = 'flex';
      itemContainer.style.alignItems = 'center';
      itemContainer.style.gap = '12px';
      itemContainer.style.padding = '8px';
      itemContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
    } else if (layout === 'card' || layout === 'grid') {
      itemContainer.style.display = 'flex';
      itemContainer.style.flexDirection = 'column';
      itemContainer.style.padding = '12px';
      itemContainer.style.border = '1px solid var(--background-modifier-border)';
      itemContainer.style.borderRadius = '8px';
    }
    
    switch (searchType) {
      case 'track':
        this.renderTrackSearchResult(itemContainer, item, layout);
        break;
      case 'album':
        this.renderAlbumSearchResult(itemContainer, item, layout);
        break;
      case 'artist':
        this.renderArtistSearchResult(itemContainer, item, layout);
        break;
      case 'playlist':
        this.renderPlaylistSearchResult(itemContainer, item, layout);
        break;
    }
    
    el.appendChild(itemContainer);
  });
}

// Updated search result rendering methods to handle layout
renderTrackSearchResult(el, track, layout) {
  if (track.album?.images?.[0]) {
    const img = document.createElement('img');
    img.src = track.album.images[0].url;
    img.className = 'spotify-search-result-image';
    
    if (layout === 'list') {
      img.style.width = '48px';
      img.style.height = '48px';
    } else {
      img.style.width = '100%';
      img.style.aspectRatio = '1';
      img.style.objectFit = 'cover';
      img.style.marginBottom = '8px';
    }
    
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  info.style.flex = '1';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = track.name;
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '4px';
  info.appendChild(title);
  
  const artist = document.createElement('div');
  artist.className = 'spotify-search-result-subtitle';
  artist.textContent = track.artists.map(a => a.name).join(', ');
  artist.style.color = 'var(--text-muted)';
  artist.style.marginBottom = '2px';
  info.appendChild(artist);
  
  const album = document.createElement('div');
  album.className = 'spotify-search-result-detail';
  album.textContent = track.album.name;
  album.style.color = 'var(--text-muted)';
  album.style.fontSize = '0.9em';
  info.appendChild(album);
  
  el.appendChild(info);
}

renderAlbumSearchResult(el, album, layout) {
  if (album.images?.[0]) {
    const img = document.createElement('img');
    img.src = album.images[0].url;
    img.className = 'spotify-search-result-image';
    
    if (layout === 'list') {
      img.style.width = '48px';
      img.style.height = '48px';
    } else {
      img.style.width = '100%';
      img.style.aspectRatio = '1';
      img.style.objectFit = 'cover';
      img.style.marginBottom = '8px';
    }
    
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  info.style.flex = '1';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = album.name;
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '4px';
  info.appendChild(title);
  
  const artist = document.createElement('div');
  artist.className = 'spotify-search-result-subtitle';
  artist.textContent = album.artists.map(a => a.name).join(', ');
  artist.style.color = 'var(--text-muted)';
  artist.style.marginBottom = '2px';
  info.appendChild(artist);
  
  const releaseDate = document.createElement('div');
  releaseDate.className = 'spotify-search-result-detail';
  releaseDate.textContent = new Date(album.release_date).getFullYear();
  releaseDate.style.color = 'var(--text-muted)';
  releaseDate.style.fontSize = '0.9em';
  info.appendChild(releaseDate);
  
  el.appendChild(info);
}

renderArtistSearchResult(el, artist, layout) {
  if (artist.images?.[0]) {
    const img = document.createElement('img');
    img.src = artist.images[0].url;
    img.className = 'spotify-search-result-image';
    
    if (layout === 'list') {
      img.style.width = '48px';
      img.style.height = '48px';
      img.style.borderRadius = '50%';
    } else {
      img.style.width = '100%';
      img.style.aspectRatio = '1';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '50%';
      img.style.marginBottom = '8px';
    }
    
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  info.style.flex = '1';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = artist.name;
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '4px';
  info.appendChild(title);
  
  const followers = document.createElement('div');
  followers.className = 'spotify-search-result-subtitle';
  followers.textContent = `${artist.followers.total.toLocaleString()} followers`;
  followers.style.color = 'var(--text-muted)';
  followers.style.marginBottom = '2px';
  info.appendChild(followers);
  
  if (artist.genres?.length > 0) {
    const genres = document.createElement('div');
    genres.className = 'spotify-search-result-detail';
    genres.textContent = artist.genres.slice(0, 3).join(', ');
    genres.style.color = 'var(--text-muted)';
    genres.style.fontSize = '0.9em';
    info.appendChild(genres);
  }
  
  el.appendChild(info);
}

renderPlaylistSearchResult(el, playlist, layout) {
  if (playlist.images?.[0]) {
    const img = document.createElement('img');
    img.src = playlist.images[0].url;
    img.className = 'spotify-search-result-image';
    
    if (layout === 'list') {
      img.style.width = '48px';
      img.style.height = '48px';
    } else {
      img.style.width = '100%';
      img.style.aspectRatio = '1';
      img.style.objectFit = 'cover';
      img.style.marginBottom = '8px';
    }
    
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  info.style.flex = '1';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = playlist.name;
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '4px';
  info.appendChild(title);
  
  const owner = document.createElement('div');
  owner.className = 'spotify-search-result-subtitle';
  owner.textContent = `by ${playlist.owner.display_name}`;
  owner.style.color = 'var(--text-muted)';
  owner.style.marginBottom = '2px';
  info.appendChild(owner);
  
  const trackCount = document.createElement('div');
  trackCount.className = 'spotify-search-result-detail';
  trackCount.textContent = `${playlist.tracks.total} tracks`;
  trackCount.style.color = 'var(--text-muted)';
  trackCount.style.fontSize = '0.9em';
  info.appendChild(trackCount);
  
  el.appendChild(info);
          }

  renderError(el, message) {
  this.emptyElement(el);
  const errorDiv = document.createElement('div');
  errorDiv.className = 'spotify-error';
  errorDiv.style.cssText = `
    color: #ff4444;
    padding: 10px;
    border: 1px solid #ff4444;
    border-radius: 4px;
    background-color: rgba(255, 68, 68, 0.1);
    margin: 10px 0;
  `;
  errorDiv.textContent = `Spotify Error: ${message}`;
  el.appendChild(errorDiv);
}

  // Enhanced onunload method with proper cleanup
  onunload() {
    console.log('Unloading Spotify Plugin');
    // Clear cache
    if (this.cache) {
      this.cache.clear();
    }
    // Clear any stored tokens for security
    this.accessToken = null;
    this.tokenExpiry = null;
  }
}

// Missing SpotifySettingTab class
class SpotifySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Spotify Plugin Settings' });

    // Spotify API Credentials
    containerEl.createEl('h3', { text: 'Spotify API Credentials' });
    containerEl.createEl('p', { 
      text: 'Get your credentials from the Spotify Developer Dashboard',
      cls: 'setting-item-description' 
    });

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Your Spotify application Client ID')
      .addText(text => text
        .setPlaceholder('Enter your Client ID')
        .setValue(this.plugin.settings.clientId)
        .onChange(async (value) => {
          this.plugin.settings.clientId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Client Secret')
      .setDesc('Your Spotify application Client Secret')
      .addText(text => text
        .setPlaceholder('Enter your Client Secret')
        .setValue(this.plugin.settings.clientSecret)
        .onChange(async (value) => {
          this.plugin.settings.clientSecret = value;
          await this.plugin.saveSettings();
        }));

    // Display Settings
    containerEl.createEl('h3', { text: 'Display Settings' });

    new Setting(containerEl)
      .setName('Default Layout')
      .setDesc('Choose the default layout for displaying Spotify content')
      .addDropdown(dropdown => dropdown
        .addOption('card', 'Card')
        .addOption('list', 'List')
        .addOption('grid', 'Grid')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async (value) => {
          this.plugin.settings.defaultLayout = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Album Art')
      .setDesc('Display album artwork in track and album displays')
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
      .setDesc('Display album information in track displays')
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
      .setDesc('Display genre information for artists')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showGenres)
        .onChange(async (value) => {
          this.plugin.settings.showGenres = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show Popularity')
      .setDesc('Display popularity scores')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showPopularity)
        .onChange(async (value) => {
          this.plugin.settings.showPopularity = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Grid Columns')
      .setDesc('Number of columns for grid layout')
      .addSlider(slider => slider
        .setLimits(1, 5, 1)
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

    // Authentication Status
    containerEl.createEl('h3', { text: 'Authentication Status' });
    
    const authStatus = containerEl.createEl('div');
    if (this.plugin.accessToken) {
      authStatus.innerHTML = '<span style="color: #4CAF50;">✓ Connected to Spotify</span>';
    } else {
      authStatus.innerHTML = '<span style="color: #f44336;">✗ Not connected to Spotify</span>';
    }

    // Test Connection Button
    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Test your Spotify API connection')
      .addButton(button => button
        .setButtonText('Test Connection')
        .onClick(async () => {
          button.setButtonText('Testing...');
          try {
            await this.plugin.authenticateSpotify();
            new Notice('✓ Spotify connection successful!');
            this.display(); // Refresh the settings display
          } catch (error) {
            new Notice('✗ Spotify connection failed. Check your credentials.');
          }
          button.setButtonText('Test Connection');
        }));

    // Clear Cache Button
    new Setting(containerEl)
      .setName('Clear Cache')
      .setDesc('Clear cached Spotify data')
      .addButton(button => button
        .setButtonText('Clear Cache')
        .onClick(() => {
          this.plugin.cache.clear();
          new Notice('Cache cleared successfully!');
        }));
  }
}

// Export the plugin
module.exports = SpotifyPlugin;
