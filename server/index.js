import { createAppServer } from './app.js';

const PORT = Number(process.env.PORT) || 3001;
const { server } = createAppServer();

server.listen(PORT, () => {
  console.log(`DAR Region VIII SPLIT Consolidated Hub running at http://localhost:${PORT}`);
});
