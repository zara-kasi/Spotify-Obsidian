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
      tokenExpiresAt: null
    };
    this.settings = Object.assign({}, defaults, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ===================== SPOTIFY AUTH =====================

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

      if (!response.ok) throw new Error(`Authentication failed: ${response.status}`);

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      this.settings.accessToken = data.access_token;
      this.settings.tokenExpiresAt = this.tokenExpiry;
      await this.saveSettings();
      console.log('Spotify authentication successful');
      return true;
    } catch (error) {
      console.error('Spotify authentication error:', error);
      new Notice('Spotify authentication failed. Please check your credentials.');
      return false;
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



  async searchSpotify(query, type = 'track', limit = 20) {
    const encodedQuery = encodeURIComponent(query);
    return await this.makeSpotifyRequest(`/search?q=${encodedQuery}&type=${type}&limit=${limit}`);
  }

  async makeSpotifyRequest(endpoint, method = 'GET', body = null) {
    const accessToken = await this.getValidAccessToken();
    const url = `https://api.spotify.com/v1${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    const options = { method, headers };
    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Spotify API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }
    if (response.status === 204) return null;
    return await response.json();
  }

  // ===================== RENDERING =====================

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
    // Add this method anywhere in your class (I suggest near other utility methods)
formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

      renderSearchResults(el, results, config) {
  el.empty();
  
  const searchType = config.searchType || 'track';
  const items = results[searchType + 's']?.items || [];
  
  if (items.length === 0) {
    el.innerHTML = '<div class="spotify-no-results">No results found</div>';
    return;
  }
  
  items.forEach(item => {
    const itemContainer = document.createElement('div');
    itemContainer.className = 'spotify-search-result-item';
    
    switch (searchType) {
      case 'track':
        this.renderTrackSearchResult(itemContainer, item);
        break;
      case 'album':
        this.renderAlbumSearchResult(itemContainer, item);
        break;
      case 'artist':
        this.renderArtistSearchResult(itemContainer, item);
        break;
      case 'playlist':
        this.renderPlaylistSearchResult(itemContainer, item);
        break;
    }
    
    el.appendChild(itemContainer);
  });
}

// Add these helper methods for search results:
renderTrackSearchResult(el, track) {
  if (track.album?.images?.[0]) {
    const img = document.createElement('img');
    img.src = track.album.images[0].url;
    img.className = 'spotify-search-result-image';
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = track.name;
  info.appendChild(title);
  
  const artist = document.createElement('div');
  artist.className = 'spotify-search-result-subtitle';
  artist.textContent = track.artists.map(a => a.name).join(', ');
  info.appendChild(artist);
  
  const album = document.createElement('div');
  album.className = 'spotify-search-result-detail';
  album.textContent = track.album.name;
  info.appendChild(album);
  
  el.appendChild(info);
}
  renderPlaylistSearchResult(el, playlist) {
  if (playlist.images?.[0]) {
    const img = document.createElement('img');
    img.src = playlist.images[0].url;
    img.className = 'spotify-search-result-image';
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = playlist.name;
  info.appendChild(title);
  
  const owner = document.createElement('div');
  owner.className = 'spotify-search-result-subtitle';
  owner.textContent = `by ${playlist.owner.display_name}`;
  info.appendChild(owner);
  
  const trackCount = document.createElement('div');
  trackCount.className = 'spotify-search-result-detail';
  trackCount.textContent = `${playlist.tracks.total} tracks`;
  info.appendChild(trackCount);
  
  el.appendChild(info);
}

renderAlbumSearchResult(el, album) {
  if (album.images?.[0]) {
    const img = document.createElement('img');
    img.src = album.images[0].url;
    img.className = 'spotify-search-result-image';
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = album.name;
  info.appendChild(title);
  
  const artist = document.createElement('div');
  artist.className = 'spotify-search-result-subtitle';
  artist.textContent = album.artists.map(a => a.name).join(', ');
  info.appendChild(artist);
  
  const releaseDate = document.createElement('div');
  releaseDate.className = 'spotify-search-result-detail';
  releaseDate.textContent = new Date(album.release_date).getFullYear();
  info.appendChild(releaseDate);
  
  el.appendChild(info);
}
  renderArtistSearchResult(el, artist) {
  if (artist.images?.[0]) {
    const img = document.createElement('img');
    img.src = artist.images[0].url;
    img.className = 'spotify-search-result-image';
    el.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-search-result-info';
  
  const title = document.createElement('div');
  title.className = 'spotify-search-result-title';
  title.textContent = artist.name;
  info.appendChild(title);
  
  const followers = document.createElement('div');
  followers.className = 'spotify-search-result-subtitle';
  followers.textContent = `${artist.followers.total.toLocaleString()} followers`;
  info.appendChild(followers);
  
  if (artist.genres?.length > 0) {
    const genres = document.createElement('div');
    genres.className = 'spotify-search-result-detail';
    genres.textContent = artist.genres.slice(0, 3).join(', ');
    info.appendChild(genres);
  }
  
  el.appendChild(info);
  }
  }

renderTrack(el, track, config) {
  const container = document.createElement('div');
  container.className = `spotify-track spotify-${config.layout || 'card'}`;
  
  const trackEl = document.createElement('div');
  trackEl.className = 'spotify-track-item';
  
  if (this.settings.showAlbumArt && track.album?.images?.[0]) {
    const img = document.createElement('img');
    img.src = track.album.images[0].url;
    img.className = 'spotify-album-art';
    trackEl.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-track-info';
  
  const title = document.createElement('div');
  title.className = 'spotify-track-title';
  title.textContent = track.name;
  info.appendChild(title);
  
  if (this.settings.showArtist) {
    const artist = document.createElement('div');
    artist.className = 'spotify-track-artist';
    artist.textContent = track.artists.map(a => a.name).join(', ');
    info.appendChild(artist);
  }
  
  if (this.settings.showAlbum && track.album) {
    const album = document.createElement('div');
    album.className = 'spotify-track-album';
    album.textContent = track.album.name;
    info.appendChild(album);
  }
  
  if (this.settings.showDuration && track.duration_ms) {
    const duration = document.createElement('div');
    duration.className = 'spotify-track-duration';
    duration.textContent = this.formatDuration(track.duration_ms);
    info.appendChild(duration);
  }
  
  trackEl.appendChild(info);
  container.appendChild(trackEl);
  el.appendChild(container);
}


  renderAlbum(el, album, config) {
    // Implement your album rendering logic here
    el.innerHTML = `<div><b>${album.name}</b> by ${album.artists.map(a => a.name).join(', ')}</div>`;
  }

  renderArtist(el, artist, config) {
    // Implement your artist rendering logic here
    el.innerHTML = `<div><b>${artist.name}</b></div>`;
  }

 renderPlaylist(el, playlist, config) {
  const container = document.createElement('div');
  container.className = `spotify-playlist spotify-${config.layout || 'list'}`;
  
  // Playlist header
  const header = document.createElement('div');
  header.className = 'spotify-playlist-header';
  
  if (this.settings.showAlbumArt && playlist.images?.[0]) {
    const img = document.createElement('img');
    img.src = playlist.images[0].url;
    img.className = 'spotify-playlist-art';
    header.appendChild(img);
  }
  
  const info = document.createElement('div');
  info.className = 'spotify-playlist-info';
  
  const title = document.createElement('h3');
  title.className = 'spotify-playlist-title';
  title.textContent = playlist.name;
  info.appendChild(title);
  
  const owner = document.createElement('div');
  owner.className = 'spotify-playlist-owner';
  owner.textContent = `by ${playlist.owner.display_name}`;
  info.appendChild(owner);
  
  const trackCount = document.createElement('div');
  trackCount.className = 'spotify-playlist-count';
  trackCount.textContent = `${playlist.tracks.total} tracks`;
  info.appendChild(trackCount);
  
  header.appendChild(info);
  container.appendChild(header);
  
  // Playlist tracks
  if (playlist.tracks?.items?.length > 0) {
    const tracksList = document.createElement('div');
    tracksList.className = 'spotify-playlist-tracks';
    
    playlist.tracks.items.forEach((item, index) => {
      if (item.track) {
        const trackItem = document.createElement('div');
        trackItem.className = 'spotify-playlist-track-item';
        
        const trackNumber = document.createElement('div');
        trackNumber.className = 'spotify-track-number';
        trackNumber.textContent = (index + 1).toString();
        trackItem.appendChild(trackNumber);
        
        const trackInfo = document.createElement('div');
        trackInfo.className = 'spotify-track-info';
        
        const trackTitle = document.createElement('div');
        trackTitle.className = 'spotify-track-title';
        trackTitle.textContent = item.track.name;
        trackInfo.appendChild(trackTitle);
        
        const trackArtist = document.createElement('div');
        trackArtist.className = 'spotify-track-artist';
        trackArtist.textContent = item.track.artists.map(a => a.name).join(', ');
        trackInfo.appendChild(trackArtist);
        
        trackItem.appendChild(trackInfo);

        if (this.settings.showDuration && item.track.duration_ms) {
          const duration = document.createElement('div');
          duration.className = 'spotify-track-duration';
          duration.textContent = this.formatDuration(item.track.duration_ms);
          trackItem.appendChild(duration);
        }
        
        tracksList.appendChild(trackItem);
      }
    });
    
    container.appendChild(tracksList);
  }
  
  el.appendChild(container);
 }

  renderSearchInterface(el, config) {
  const container = document.createElement('div');
  container.className = 'spotify-search-container';
  
  // Search input
  const searchBox = document.createElement('div');
  searchBox.className = 'spotify-search-box';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = `Search ${config.searchType || 'tracks'}...`;
  searchInput.className = 'spotify-search-input';
  
  const searchButton = document.createElement('button');
  searchButton.textContent = 'Search';
  searchButton.className = 'spotify-search-button';
  
  searchBox.appendChild(searchInput);
  searchBox.appendChild(searchButton);
  container.appendChild(searchBox);
  
  // Results container
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'spotify-search-results';
  container.appendChild(resultsContainer);
  
  // Search function
  const performSearch = async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    
    try {
      searchButton.textContent = 'Searching...';
      searchButton.disabled = true;
      
      const searchConfig = {
        type: 'search',
        query: query,
        searchType: config.searchType || 'track',
        limit: config.limit || 20
      };
      
      const results = await this.fetchSpotifyData(searchConfig);
      this.renderSearchResults(resultsContainer, results, searchConfig);
      
    } catch (error) {
      this.renderError(resultsContainer, `Search failed: ${error.message}`);
    } finally {
      searchButton.textContent = 'Search';
      searchButton.disabled = false;
    }
  };
  
  // Event listeners
  searchButton.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  
  el.appendChild(container);
}


  renderError(el, message) {
    el.innerHTML = `<div class="spotify-error">Error: ${message}</div>`;
  }
}

// ===================== SETTINGS TAB =====================

class SpotifySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Spotify Integration Settings' });

    // Authentication settings
    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Your Spotify App Client ID')
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
      .addButton(button => button
        .setButtonText('Test Connection')
        .onClick(async () => {
          const success = await this.plugin.authenticateSpotify();
          if (success) new Notice('✅ Spotify connection successful!');
          else new Notice('❌ Spotify connection failed. Check your credentials.');
        }));

    // Other settings ...

    // Documentation
    new Setting(containerEl)
      .setName('Setup Guide')
      .addButton(button => button
        .setButtonText('View Setup Guide')
        .onClick(() => {
          window.open('https://developer.spotify.com/documentation/web-api/tutorials/getting-started', '_blank');
        }));
  }
}

module.exports = SpotifyPlugin;
// Add this helper for DOM manipulation
HTMLElement.prototype.empty = function() {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};
