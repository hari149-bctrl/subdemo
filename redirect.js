// redirect.js
const express = require('express');
const app = express();

app.get('/redirect', (req, res) => {
  const code = req.query.code;
  console.log('✅ AUTH CODE:', code);
  res.send(`✅ Received auth code: ${code}`);
});

app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});
