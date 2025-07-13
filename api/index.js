// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const querystring = require('querystring');
const serverless = require('serverless-http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory token storage (for demo; use DB in production)
let access_token = null;
let refresh_token = null;
let token_expires_at = null;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-top-read',
  'streaming',
].join(' ');

// 1. Auth endpoint
app.get('/auth', (req, res) => {
  const params = querystring.stringify({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    show_dialog: true,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// 2. Callback endpoint
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');
  try {
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: SPOTIFY_CLIENT_ID,
        client_secret: SPOTIFY_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    access_token = tokenRes.data.access_token;
    refresh_token = tokenRes.data.refresh_token;
    token_expires_at = Date.now() + tokenRes.data.expires_in * 1000;
    res.send('Authentication successful! You can close this window.');
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tokens', details: err.response?.data || err.message });
  }
});

// Helper: Refresh token if expired
async function ensureAccessToken() {
  if (!access_token || Date.now() > token_expires_at) {
    if (!refresh_token) throw new Error('No refresh token available');
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token,
        client_id: SPOTIFY_CLIENT_ID,
        client_secret: SPOTIFY_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    access_token = tokenRes.data.access_token;
    if (tokenRes.data.refresh_token) refresh_token = tokenRes.data.refresh_token;
    token_expires_at = Date.now() + tokenRes.data.expires_in * 1000;
  }
}

// 3. Main endpoint: Get top tracks and now playing
app.get('/spotify', async (req, res) => {
  try {
    await ensureAccessToken();
    // Get top tracks (short term)
    const topTracksRes = await axios.get('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=short_term', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const top_tracks = topTracksRes.data.items.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      duration_ms: track.duration_ms,
      external_urls: track.external_urls.spotify,
      preview_url: track.preview_url,
      uri: track.uri,
    }));
    // Get currently playing
    const nowPlayingRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    let now_playing = null;
    if (nowPlayingRes.data && nowPlayingRes.data.item) {
      const item = nowPlayingRes.data.item;
      now_playing = {
        id: item.id,
        name: item.name,
        artists: item.artists.map(a => a.name).join(', '),
        album: item.album.name,
        duration_ms: item.duration_ms,
        progress_ms: nowPlayingRes.data.progress_ms,
        is_playing: nowPlayingRes.data.is_playing,
        external_urls: item.external_urls.spotify,
        uri: item.uri,
      };
    }
    res.json({
      top_tracks,
      now_playing,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data', details: err.response?.data || err.message });
  }
});

// 4. Playback control endpoints
app.post('/spotify/pause', async (req, res) => {
  try {
    await ensureAccessToken();
    await axios.put('https://api.spotify.com/v1/me/player/pause', {}, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    res.json({ message: 'Playback paused successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause playback', details: err.response?.data || err.message });
  }
});

app.post('/spotify/resume', async (req, res) => {
  try {
    await ensureAccessToken();
    await axios.put('https://api.spotify.com/v1/me/player/play', {}, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    res.json({ message: 'Playback resumed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume playback', details: err.response?.data || err.message });
  }
});

app.post('/spotify/play', async (req, res) => {
  try {
    await ensureAccessToken();
    const { uri } = req.body;
    if (!uri) return res.status(400).json({ error: 'Missing uri in request body' });
    await axios.put('https://api.spotify.com/v1/me/player/play', { uris: [uri] }, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    res.json({ message: 'Playback started successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start playback', details: err.response?.data || err.message });
  }
});

// 5. Utility endpoint: Get devices
app.get('/spotify/devices', async (req, res) => {
  try {
    await ensureAccessToken();
    const devicesRes = await axios.get('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    res.json(devicesRes.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get devices', details: err.response?.data || err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

// 6. Export for Vercel serverless
module.exports = serverless(app);

 