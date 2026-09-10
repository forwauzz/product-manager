/* Cloudflare D1 store: one row holds the whole document. Optimistic versioning is enforced
   by the UPDATE ... WHERE version = ? so two devices can never silently clobber each other. */
import { ConflictError, normalize, seed } from "../shared/core.js";

const ID = "main";

export class D1Store {
  constructor(db) { this.db = db; }

  async _row() {
    return this.db.prepare("SELECT version, state FROM documents WHERE id = ?").bind(ID).first();
  }

  async load() {
    const row = await this._row();
    if (row) return { version: Number(row.version), state: normalize(JSON.parse(row.state)) };
    const state = normalize(seed());
    await this.db.prepare("INSERT OR IGNORE INTO documents (id, version, state, updated_at) VALUES (?, 1, ?, ?)")
      .bind(ID, JSON.stringify(state), new Date().toISOString()).run();
    const again = await this._row();
    return { version: Number(again.version), state: normalize(JSON.parse(again.state)) };
  }

  async save(state, expected) {
    const clean = normalize(JSON.parse(JSON.stringify(state)));
    const text = JSON.stringify(clean);
    const now = new Date().toISOString();
    await this.load(); // makes sure the row exists
    let res;
    if (expected === null || expected === undefined) {
      res = await this.db.prepare("UPDATE documents SET version = version + 1, state = ?, updated_at = ? WHERE id = ?")
        .bind(text, now, ID).run();
    } else {
      res = await this.db.prepare("UPDATE documents SET version = version + 1, state = ?, updated_at = ? WHERE id = ? AND version = ?")
        .bind(text, now, ID, Number(expected)).run();
      if (!res.meta || res.meta.changes !== 1) throw new ConflictError(await this.load());
    }
    return this.load();
  }

  async reset() {
    return this.save(seed(), null);
  }
}
