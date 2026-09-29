import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createApiApp } from "./backend/apiApp";
import { startLocalScheduler } from "./push-server/routes";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // All /api/* routes live in backend/apiApp.ts (shared with the Vercel serverless entry api/index.ts)
  app.use(createApiApp());

  // Serve public directory static assets (PWA manifest, service worker, icons, assetlinks)
  app.use(express.static(path.join(process.cwd(), "public"), { dotfiles: "allow" }));

  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.sendFile(path.join(process.cwd(), "public/.well-known/assetlinks.json"));
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DocReminder server running on http://0.0.0.0:${PORT}`);
    startLocalScheduler();
  });
}

startServer();
