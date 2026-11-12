import { createAppServer } from '../server/app.js';

let appInstance = null;

function getApp() {
  if (!appInstance) {
    appInstance = createAppServer();
  }
  return appInstance;
}

/**
 * Vercel Serverless Function entrypoint delegating all `/api/*` requests
 * to the shared SALIG HTTP handler without duplicating route logic.
 */
export default function vercelHandler(req, res) {
  return getApp().handler(req, res);
}

