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

  async fetchPlaylist(id) {
    const playlist = await this.makeSpotifyRequest(`/playlists/${id}`);
    return playlist;
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
  }

  renderTrack(el, track, config) {
    // Implement your track rendering logic here (as in your original code)
    el.innerHTML = `<div><b>${track.name}</b> by ${track.artists.map(a => a.name).join(', ')}</div>`;
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
    // Implement your playlist rendering logic here
    el.innerHTML = `<div><b>${playlist.name}</b> by ${playlist.owner.display_name}</div>`;
  }

  renderSearchInterface(el, config) {
    // Implement your search interface rendering logic here (see your original for inspiration)
    el.innerHTML = `<div>Spotify Search UI goes here.</div>`;
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
