import 'dotenv/config';
import { createApp } from './app.js';
import { createDb } from './db.js';
import { makeRepo } from './repo.js';

const db = createDb();
const app = createApp({ db, repo: makeRepo(db) });

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`DEADVERSE API listening on http://localhost:${port}/api/health`);
});

export default app;
