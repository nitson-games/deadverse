import 'dotenv/config';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { makeRepo } from '../server/repo.js';

const db = createDb();

export default createApp({ db, repo: makeRepo(db) });
