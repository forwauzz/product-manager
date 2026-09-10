/* JSON-file store for local use. Atomic writes (tmp + rename) and optimistic versioning. */
import fs from "node:fs";
import path from "node:path";
import { ConflictError, normalize, seed } from "../shared/core.js";

export class FileStore {
  constructor(file) {
    this.file = file;
    this.version = 0;
    this.state = null;
    this._read();
  }
  _read() {
    try {
      const doc = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.version = Number(doc.version) || 1;
      const hadIcps = !!(doc.state && Array.isArray(doc.state.icps));
      this.state = normalize(doc.state);
      if (!hadIcps) this._write(); // seeded profiles must keep their ids across restarts
    } catch (e) {
      if (e.code !== "ENOENT") {
        // Corrupt file: keep a copy so nothing is lost, then start again from the seed.
        try { fs.copyFileSync(this.file, this.file + ".corrupt-" + Date.now()); } catch (_) { /* ignore */ }
      }
      this.version = 1;
      this.state = normalize(seed());
      this._write();
    }
  }
  _write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: this.version, savedAt: new Date().toISOString(), state: this.state }, null, 2));
    fs.renameSync(tmp, this.file);
  }
  _snapshot() { return { version: this.version, state: JSON.parse(JSON.stringify(this.state)) }; }
  async load() { return this._snapshot(); }
  async save(state, expected) {
    if (expected !== null && expected !== undefined && Number(expected) !== this.version) throw new ConflictError(this._snapshot());
    this.state = normalize(JSON.parse(JSON.stringify(state)));
    this.version += 1;
    this._write();
    return this._snapshot();
  }
  async reset() {
    this.state = normalize(seed());
    this.version += 1;
    this._write();
    return this._snapshot();
  }
}
