const express = require('express');
const serverless = require('serverless-http');
const app = express();

app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

app.get('/ping', (req, res) => {
  res.json({ pong: true });
});

module.exports = serverless(app);

 