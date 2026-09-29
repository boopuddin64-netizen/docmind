/**
 * Vercel serverless entry: every /api/* request is rewritten here (see vercel.json) and handled by the
 * same Express app that server.ts mounts locally.
 */
import { createApiApp } from "../backend/apiApp.js";

export default createApiApp();
