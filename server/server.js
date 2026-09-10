/* Local server: Express + JSON file store. The API itself lives in shared/core.js. */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { handleApi } from "../shared/core.js";
import { FileStore } from "./store-file.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(opts = {}) {
  const dataFile = opts.dataFile || path.join(here, "..", "data", "db.json");
  const store = opts.store || new FileStore(dataFile);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));

  /* Local mode has no login; the session endpoint tells the client so. */
  app.get("/api/session", (req, res) => res.json({ authed: true, required: false }));
  app.post("/api/logout", (req, res) => res.status(204).end());

  app.all("/api/*", async (req, res, next) => {
    try {
      const out = await handleApi({ method: req.method, path: req.path.replace(/^\/api/, ""), query: req.query, body: req.body }, store);
      Object.entries(out.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
      if (out.status === 204) return res.status(204).end();
      res.status(out.status).json(out.body);
    } catch (e) { next(e); }
  });

  app.use(express.static(path.join(here, "..", "public"), { extensions: ["html"] }));
  app.get("*", (req, res) => res.sendFile(path.join(here, "..", "public", "index.html")));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
    res.status(status).json({ error: err.message || "Server error" });
  });

  app.locals.store = store;
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 4177;
  createApp().listen(port, "127.0.0.1", () => {
    console.log("ALIE Product Manager running at http://localhost:" + port);
  });
}
