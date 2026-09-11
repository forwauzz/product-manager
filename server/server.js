/* Local server: Express + JSON file store. The API itself lives in shared/core.js. */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { handleApi } from "../shared/core.js";
import { FileStore } from "./store-file.js";

const here = path.dirname(fileURLToPath(import.meta.url));

import fs from "node:fs";

/* Screenshots live next to the data file as JPEG/PNG files; the feature record keeps the URL. */
function makeShotStore(dir, store) {
  fs.mkdirSync(dir, { recursive: true });
  function parse(dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
    if (!m) return null;
    return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
  }
  const ext = mime => mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return {
    async saveShot(featureId, dataUrl) {
      const doc = await store.load();
      const f = doc.state.features.find(x => x.id === featureId);
      if (!f) return { error: "unknown feature" };
      const img = parse(dataUrl);
      if (!img) return { error: "data must be a base64 image data URL" };
      if (img.buffer.length > 8 * 1024 * 1024) return { error: "image larger than 8 MB" };
      for (const e of ["jpg", "png", "webp"]) { try { fs.unlinkSync(path.join(dir, featureId + "." + e)); } catch (_) { /* none */ } }
      fs.writeFileSync(path.join(dir, featureId + "." + ext(img.mime)), img.buffer);
      const url = "/api/shots/" + featureId + "?v=" + Date.now();
      f.image = url; f.updated = Date.now();
      await store.save(doc.state, doc.version);
      return { feature: featureId, image: url, bytes: img.buffer.length };
    },
    async readShot(featureId) {
      for (const e of ["jpg", "png", "webp"]) {
        const file = path.join(dir, featureId + "." + e);
        if (fs.existsSync(file)) return { mime: e === "jpg" ? "image/jpeg" : "image/" + e, buffer: fs.readFileSync(file) };
      }
      return null;
    },
    async deleteShot(featureId) {
      for (const e of ["jpg", "png", "webp"]) { try { fs.unlinkSync(path.join(dir, featureId + "." + e)); } catch (_) { /* none */ } }
      const doc = await store.load();
      const f = doc.state.features.find(x => x.id === featureId);
      if (f && f.image) { f.image = ""; f.updated = Date.now(); await store.save(doc.state, doc.version); }
    }
  };
}

export function createApp(opts = {}) {
  const dataFile = opts.dataFile || path.join(here, "..", "data", "db.json");
  const store = opts.store || new FileStore(dataFile);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));
  const shotsDir = opts.shotsDir || path.join(path.dirname(dataFile), "shots");
  const { saveShot, readShot, deleteShot } = makeShotStore(shotsDir, store);
  app.use("/api/shots", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  /* Capture channel for the screenshot campaign: a page that cannot POST cross-origin navigates here
     with the image in the query string, and is sent straight back to where it came from. */
  app.get("/api/shots/nav", async (req, res, next) => {
    try {
      const ids = String(req.query.feature || "").split(",").map(x => x.trim()).filter(Boolean);
      let out = { error: "no feature" };
      for (const id of ids) { out = await saveShot(id, String(req.query.data || "")); if (out.error) break; }
      const back = String(req.query.back || "");
      if (out.error) return res.status(400).send("<p>" + out.error + "</p>");
      if (/^https:\/\/(health|legal|admin)\.alie\.app\//.test(back)) return res.redirect(302, back);
      res.send("<p>saved " + out.bytes + " bytes</p>");
    } catch (e) { next(e); }
  });
  app.get("/api/shots/:id", async (req, res) => {
    const shot = await readShot(req.params.id);
    if (!shot) return res.status(404).json({ error: "no screenshot" });
    res.setHeader("Content-Type", shot.mime);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(shot.buffer);
  });
  app.post("/api/shots", async (req, res, next) => {
    try {
      const b = req.body || {};
      const out = await saveShot(String(b.feature || ""), String(b.data || ""));
      if (out.error) return res.status(400).json(out);
      res.json(out);
    } catch (e) { next(e); }
  });
  app.delete("/api/shots/:id", async (req, res) => {
    await deleteShot(req.params.id);
    res.status(204).end();
  });

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
