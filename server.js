const http = require("http");
const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const {
  readDb,
  writeDb,
  upsertSupplier,
  deleteSupplier,
  getCategories,
  addCategory,
  upsertProduct,
  deleteProduct,
  planProductImport,
  importProductsFromSpreadsheet,
  createPurchase,
  createSale,
  getSummary
} = require("./src/storage");
const { extractProductsFromSpreadsheet } = require("./src/spreadsheetImport");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const appUser = process.env.APP_USER || "admin";
const appPassword = process.env.APP_PASSWORD || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers
  });
  res.end(body);
}

function sendJson(res, payload, status = 200) {
  send(res, status, payload, { "Cache-Control": "no-store" });
}

function isAuthorized(req) {
  if (!appPassword) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return user === appUser && password === appPassword;
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Loja ERP"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("Autenticacao obrigatoria.");
  return false;
}

function readBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Payload muito grande."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        error.status = 400;
        error.message = "JSON invalido.";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Acesso negado.");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Arquivo nao encontrado.");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[1];
  const id = parts[2];

  try {
    if (method === "GET" && resource === "health") {
      return sendJson(res, { ok: true, app: "loja-erp" });
    }

    if (method === "GET" && resource === "summary") {
      return sendJson(res, getSummary());
    }

    if (method === "GET" && resource === "products") {
      const db = readDb();
      return sendJson(res, db.products);
    }

    if (method === "GET" && resource === "suppliers") {
      const db = readDb();
      return sendJson(res, db.suppliers || []);
    }

    if (method === "GET" && resource === "categories") {
      return sendJson(res, getCategories());
    }

    if (method === "POST" && resource === "categories") {
      const input = await readBody(req);
      return sendJson(res, addCategory(input), 201);
    }

    if (method === "POST" && resource === "suppliers") {
      const input = await readBody(req);
      return sendJson(res, upsertSupplier(input), 201);
    }

    if (method === "PUT" && resource === "suppliers" && id) {
      const input = await readBody(req);
      return sendJson(res, upsertSupplier({ ...input, id }));
    }

    if (method === "DELETE" && resource === "suppliers" && id) {
      return sendJson(res, deleteSupplier(id));
    }

    if (method === "POST" && resource === "products") {
      const input = await readBody(req);
      return sendJson(res, upsertProduct(input), 201);
    }

    if (method === "POST" && resource === "products-import") {
      const input = await readBody(req, 12_000_000);
      const buffer = Buffer.from(String(input.contentBase64 || ""), "base64");
      if (!buffer.length) {
        return sendJson(res, { error: "Arquivo da planilha nao enviado." }, 400);
      }

      const extracted = extractProductsFromSpreadsheet(input.fileName || "estoque.xlsx", buffer);
      const replaceStock = input.replaceStock !== false;
      const plan = planProductImport(extracted.products, { replaceStock });
      const errors = [...(extracted.errors || []), ...(plan.errors || [])];

      if (input.apply === true) {
        if (errors.length) {
          return sendJson(res, { ...extracted, ...plan, errors, error: "Corrija os erros antes de importar." }, 400);
        }
        const imported = importProductsFromSpreadsheet(extracted.products, { replaceStock });
        return sendJson(res, { ...extracted, ...imported });
      }

      return sendJson(res, { ...extracted, ...plan, errors });
    }

    if (method === "PUT" && resource === "products" && id) {
      const input = await readBody(req);
      return sendJson(res, upsertProduct({ ...input, id }));
    }

    if (method === "DELETE" && resource === "products" && id) {
      return sendJson(res, deleteProduct(id));
    }

    if (method === "GET" && resource === "purchases") {
      const db = readDb();
      return sendJson(res, db.purchases);
    }

    if (method === "POST" && resource === "purchases") {
      const input = await readBody(req);
      return sendJson(res, createPurchase(input), 201);
    }

    if (method === "GET" && resource === "sales") {
      const db = readDb();
      return sendJson(res, db.sales);
    }

    if (method === "POST" && resource === "sales") {
      const input = await readBody(req);
      return sendJson(res, createSale(input), 201);
    }

    if (method === "GET" && resource === "movements") {
      const db = readDb();
      return sendJson(res, db.movements.slice().reverse());
    }

    if (method === "GET" && resource === "export") {
      return sendJson(res, readDb());
    }

    if (method === "POST" && resource === "import") {
      const input = await readBody(req);
      const next = {
        meta: input.meta || {},
        products: input.products || [],
        suppliers: input.suppliers || [],
        categories: input.categories || [],
        purchases: input.purchases || [],
        sales: input.sales || [],
        movements: input.movements || []
      };
      writeDb(next);
      return sendJson(res, { ok: true });
    }

    return sendJson(res, { error: "Rota nao encontrada." }, 404);
  } catch (error) {
    return sendJson(res, { error: error.message || "Erro interno." }, error.status || 500);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/health" && !requireAuth(req, res)) return;
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Loja ERP rodando em http://localhost:${port}`);
});
