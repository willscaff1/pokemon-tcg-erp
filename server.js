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
const { generateClientStockPdf } = require("./src/pdfReport");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const appUser = process.env.APP_USER || "admin";
const appPassword = process.env.APP_PASSWORD || "";
const storeName = process.env.STORE_NAME || "Scaff TCG";

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

function sendPdf(res, buffer, fileName) {
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store"
  });
  res.end(buffer);
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
    "WWW-Authenticate": 'Basic realm="Scaff TCG"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("Autenticação obrigatória.");
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
        error.message = "JSON inválido.";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function resolveStaticPath(url) {
  let requested = url.pathname;
  if (requested === "/" || requested === "/index.html" || requested.startsWith("/produto/")) {
    requested = "/store.html";
  }
  if (requested === "/admin") {
    requested = "/admin/";
  }
  if (requested === "/admin/") {
    requested = "/index.html";
  }
  if (requested.startsWith("/admin/")) {
    requested = requested.slice("/admin".length);
  }

  return path.normalize(path.join(publicDir, requested));
}

function serveStatic(req, res, url) {
  const filePath = resolveStaticPath(url);

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Acesso negado.");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Arquivo não encontrado.");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function isAdminPath(url) {
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return true;
  if (!url.pathname.startsWith("/api/")) return false;

  const publicApi = [
    "/api/health",
    "/api/storefront",
    "/api/storefront/checkout"
  ];
  return !publicApi.includes(url.pathname);
}

function publicProduct(product) {
  return {
    id: product.id,
    sku: product.sku || "",
    name: product.name,
    category: product.category || "Produto",
    description: product.description || "",
    imageDataUrl: product.imageDataUrl || "",
    salePrice: Number(product.salePrice || 0),
    stock: Number(product.stock || 0)
  };
}

async function getStorefront() {
  const db = await readDb();
  const products = db.products
    .filter((product) => product.active !== false)
    .filter((product) => Number(product.stock || 0) > 0)
    .filter((product) => Number(product.salePrice || 0) > 0)
    .map(publicProduct)
    .sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return {
    storeName: db.meta?.storeName || storeName,
    categories,
    products
  };
}

async function createStorefrontCheckout(input) {
  const db = await readDb();
  const items = Array.isArray(input.items) ? input.items : [];
  const cleanItems = items
    .map((item) => ({
      productId: String(item.productId || ""),
      quantity: Math.max(0, Number(item.quantity || 0))
    }))
    .filter((item) => item.productId && item.quantity > 0);

  if (!cleanItems.length) {
    const error = new Error("Carrinho vazio.");
    error.status = 400;
    throw error;
  }

  const saleItems = cleanItems.map((item) => {
    const product = db.products.find((candidate) => candidate.id === item.productId);
    if (!product || product.active === false || Number(product.stock || 0) <= 0) {
      const error = new Error("Produto indisponivel no estoque.");
      error.status = 400;
      throw error;
    }
    if (Number(product.stock || 0) < item.quantity) {
      const error = new Error(`Estoque insuficiente para ${product.name}.`);
      error.status = 400;
      throw error;
    }
    if (Number(product.salePrice || 0) <= 0) {
      const error = new Error(`Produto sem preco de venda: ${product.name}.`);
      error.status = 400;
      throw error;
    }
    return {
      productId: product.id,
      quantity: item.quantity,
      unitPrice: Number(product.salePrice || 0)
    };
  });

  const customerName = String(input.customerName || "").trim();
  const customerEmail = String(input.customerEmail || "").trim();
  const customerPhone = String(input.customerPhone || "").trim();
  const paymentMethod = String(input.paymentMethod || "PIX").trim();

  if (!customerName || !customerPhone) {
    const error = new Error("Informe nome e WhatsApp para finalizar o pedido.");
    error.status = 400;
    throw error;
  }

  const sale = await createSale({
    date: new Date().toISOString().slice(0, 10),
    customer: customerName,
    channel: "Site proprio",
    paymentMethod,
    paymentStatus: "Pendente",
    discount: 0,
    shippingCharged: 0,
    fees: 0,
    notes: [
      "Pedido criado pela loja online.",
      customerEmail ? `Email: ${customerEmail}` : "",
      customerPhone ? `WhatsApp: ${customerPhone}` : "",
      input.notes ? `Observacoes: ${String(input.notes).trim()}` : ""
    ].filter(Boolean).join(" | "),
    items: saleItems
  });

  return {
    ok: true,
    orderId: sale.id,
    paymentStatus: sale.paymentStatus,
    paymentMethod: sale.paymentMethod,
    total: sale.netRevenue,
    message: "Pedido recebido. Pagamento pendente de confirmacao."
  };
}

async function handleApi(req, res, url) {
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[1];
  const id = parts[2];

  try {
    if (method === "GET" && resource === "health") {
      return sendJson(res, { ok: true, app: "scaff-tcg" });
    }

    if (method === "GET" && resource === "storefront") {
      return sendJson(res, await getStorefront());
    }

    if (method === "POST" && resource === "storefront" && id === "checkout") {
      const input = await readBody(req);
      return sendJson(res, await createStorefrontCheckout(input), 201);
    }

    if (method === "GET" && resource === "summary") {
      return sendJson(res, await getSummary());
    }

    if (method === "GET" && resource === "settings") {
      const db = await readDb();
      return sendJson(res, {
        storeName: db.meta?.storeName || "Scaff TCG",
        logoDataUrl: db.meta?.logoDataUrl || ""
      });
    }

    if (method === "POST" && resource === "settings") {
      const input = await readBody(req, 6_000_000);
      const logoDataUrl = String(input.logoDataUrl || "");
      if (logoDataUrl && !/^data:image\/(png|jpe?g);base64,/i.test(logoDataUrl)) {
        return sendJson(res, { error: "Envie uma logo PNG ou JPG." }, 400);
      }
      const db = await readDb();
      db.meta = {
        ...(db.meta || {}),
        storeName: "Scaff TCG",
        logoDataUrl
      };
      await writeDb(db);
      return sendJson(res, { storeName: "Scaff TCG", logoDataUrl });
    }

    if (method === "GET" && resource === "reports" && id === "client-stock.pdf") {
      const date = new Date().toISOString().slice(0, 10);
      const pdf = generateClientStockPdf(await readDb());
      return sendPdf(res, pdf, `relatorio-estoque-cliente-${date}.pdf`);
    }

    if (method === "GET" && resource === "products") {
      const db = await readDb();
      return sendJson(res, db.products);
    }

    if (method === "GET" && resource === "suppliers") {
      const db = await readDb();
      return sendJson(res, db.suppliers || []);
    }

    if (method === "GET" && resource === "categories") {
      return sendJson(res, await getCategories());
    }

    if (method === "POST" && resource === "categories") {
      const input = await readBody(req);
      return sendJson(res, await addCategory(input), 201);
    }

    if (method === "POST" && resource === "suppliers") {
      const input = await readBody(req);
      return sendJson(res, await upsertSupplier(input), 201);
    }

    if (method === "PUT" && resource === "suppliers" && id) {
      const input = await readBody(req);
      return sendJson(res, await upsertSupplier({ ...input, id }));
    }

    if (method === "DELETE" && resource === "suppliers" && id) {
      return sendJson(res, await deleteSupplier(id));
    }

    if (method === "POST" && resource === "products") {
      const input = await readBody(req, 8_000_000);
      return sendJson(res, await upsertProduct(input), 201);
    }

    if (method === "POST" && resource === "products-import") {
      const input = await readBody(req, 12_000_000);
      const buffer = Buffer.from(String(input.contentBase64 || ""), "base64");
      if (!buffer.length) {
        return sendJson(res, { error: "Arquivo da planilha não enviado." }, 400);
      }

      const extracted = extractProductsFromSpreadsheet(input.fileName || "estoque.xlsx", buffer);
      const replaceStock = input.replaceStock !== false;
      const plan = await planProductImport(extracted.products, { replaceStock });
      const errors = [...(extracted.errors || []), ...(plan.errors || [])];

      if (input.apply === true) {
        if (errors.length) {
          return sendJson(res, { ...extracted, ...plan, errors, error: "Corrija os erros antes de importar." }, 400);
        }
        const imported = await importProductsFromSpreadsheet(extracted.products, { replaceStock });
        return sendJson(res, { ...extracted, ...imported });
      }

      return sendJson(res, { ...extracted, ...plan, errors });
    }

    if (method === "PUT" && resource === "products" && id) {
      const input = await readBody(req, 8_000_000);
      return sendJson(res, await upsertProduct({ ...input, id }));
    }

    if (method === "DELETE" && resource === "products" && id) {
      return sendJson(res, await deleteProduct(id));
    }

    if (method === "GET" && resource === "purchases") {
      const db = await readDb();
      return sendJson(res, db.purchases);
    }

    if (method === "POST" && resource === "purchases") {
      const input = await readBody(req);
      return sendJson(res, await createPurchase(input), 201);
    }

    if (method === "GET" && resource === "sales") {
      const db = await readDb();
      return sendJson(res, db.sales);
    }

    if (method === "POST" && resource === "sales") {
      const input = await readBody(req);
      return sendJson(res, await createSale(input), 201);
    }

    if (method === "GET" && resource === "movements") {
      const db = await readDb();
      return sendJson(res, db.movements.slice().reverse());
    }

    if (method === "GET" && resource === "export") {
      return sendJson(res, await readDb());
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
      await writeDb(next);
      return sendJson(res, { ok: true });
    }

    return sendJson(res, { error: "Rota não encontrada." }, 404);
  } catch (error) {
    return sendJson(res, { error: error.message || "Erro interno." }, error.status || 500);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (isAdminPath(url) && !requireAuth(req, res)) return;
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Scaff TCG rodando em http://localhost:${port}`);
});
