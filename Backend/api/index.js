// Vercel serverless entry — mounts the Express app at every route
// (see vercel.json rewrites). Local dev still uses `node server.js`.
const app = require('../server');

module.exports = app;
