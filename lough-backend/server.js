import connectDB from './src/config/db.js';
import httpServer from './src/app.js';
import config from './src/config/index.js';

connectDB().then(() => {
  httpServer.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
  });
});