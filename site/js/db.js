// Loads the SQLite database (built by scripts/build_db.py from data/) via sql.js
// and exposes a tiny query helper. No build step, no server — this all runs
// client-side against a static .sqlite file.

let sqlModulePromise = null;
let dbPromise = null;

function initSQL() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.15.2/dist/${file}`,
    });
  }
  return sqlModulePromise;
}

function loadDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQLmod = await initSQL();
      const res = await fetch("data/ckr.sqlite");
      if (!res.ok) throw new Error(`Could not load data/ckr.sqlite (${res.status})`);
      const buf = await res.arrayBuffer();
      return new SQLmod.Database(new Uint8Array(buf));
    })();
  }
  return dbPromise;
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(db, sql, params = []) {
  const rows = queryAll(db, sql, params);
  return rows.length ? rows[0] : null;
}
