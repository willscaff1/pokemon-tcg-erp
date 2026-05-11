const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

let pgPool = null;
let pgReady = false;

const now = () => new Date().toISOString();
const hashPassword = (password) => crypto.createHash("sha256").update(String(password || "")).digest("hex");
const publicCustomer = (customer) => {
  if (!customer) return null;
  const { passwordHash, ...safeCustomer } = customer;
  return safeCustomer;
};
const defaultCategories = [
  "Produto",
  "Booster",
  "Display",
  "ETB",
  "Blister",
  "Colecao especial",
  "Single",
  "Acessorio",
  "Outro"
];
const defaultStoreCategories = [
  "Todos",
  "Booster",
  "Display",
  "Elite Trainer Box",
  "Blister",
  "Coleções especiais",
  "Cartas avulsas",
  "Acessórios",
  "Novidades",
  "Promoções"
];

const initialDb = () => ({
  meta: {
    app: "loja-erp",
    version: 1,
    createdAt: now(),
    updatedAt: now()
  },
  products: [],
  suppliers: [],
  categories: [],
  purchases: [],
  sales: [],
  leads: [],
  movements: []
});

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveDataFile() {
  return path.resolve(process.cwd(), process.env.DATA_FILE || "./data/db.json");
}

function usePostgres() {
  return Boolean(process.env.DATABASE_URL);
}

async function getPgPool() {
  if (!usePostgres()) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
    });
  }
  if (!pgReady) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id integer PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    pgReady = true;
  }
  return pgPool;
}

function normalizeDb(db = {}) {
  return {
    ...initialDb(),
    ...db,
    meta: { ...initialDb().meta, ...db.meta },
    products: db.products || [],
    suppliers: db.suppliers || [],
    categories: db.categories || [],
    purchases: db.purchases || [],
    sales: db.sales || [],
    leads: db.leads || [],
    movements: db.movements || []
  };
}

async function readDb() {
  const pool = await getPgPool();
  if (pool) {
    const result = await pool.query("SELECT data FROM app_state WHERE id = 1");
    if (result.rows[0]) return normalizeDb(result.rows[0].data);

    const localFile = resolveDataFile();
    let db = initialDb();
    if (fs.existsSync(localFile)) {
      const raw = fs.readFileSync(localFile, "utf8").trim();
      if (raw) db = JSON.parse(raw);
    }
    await writeDb(db);
    return normalizeDb(db);
  }

  const file = resolveDataFile();
  ensureDir(file);

  if (!fs.existsSync(file)) {
    const db = initialDb();
    await writeDb(db);
    return db;
  }

  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return initialDb();

  return normalizeDb(JSON.parse(raw));
}

async function writeDb(db) {
  const pool = await getPgPool();
  const file = resolveDataFile();
  const next = {
    ...db,
    meta: {
      ...(db.meta || {}),
      app: "loja-erp",
      version: 1,
      updatedAt: now()
    }
  };

  if (pool) {
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(next)]
    );
    return next;
  }

  ensureDir(file);
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(next, null, 2));
  fs.renameSync(tempFile, file);
  return next;
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function generateSku(name, db, id) {
  const base = normalizeKey(name)
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 4).toUpperCase())
    .join("-") || "PROD";
  let sku = `${base}-${id.slice(-6).toUpperCase()}`;
  let counter = 2;
  while (db.products.some((product) => product.sku === sku && product.id !== id)) {
    sku = `${base}-${counter}`;
    counter += 1;
  }
  return sku;
}

function getProduct(db, productId) {
  return db.products.find((product) => product.id === productId);
}

async function getCategories() {
  const db = await readDb();
  const categories = new Set(defaultCategories);
  for (const category of db.categories || []) {
    const name = String(category || "").trim();
    if (name) categories.add(name);
  }
  for (const product of db.products || []) {
    const name = String(product.category || "").trim();
    if (name) categories.add(name);
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}

async function addCategory(input) {
  const db = await readDb();
  const name = String(input.name || input.category || "").trim();
  if (!name) {
    const error = new Error("Nome da categoria é obrigatório.");
    error.status = 400;
    throw error;
  }

  const exists = (await getCategories()).some((category) => normalizeKey(category) === normalizeKey(name));
  if (!exists) {
    db.categories = [...(db.categories || []), name].sort((a, b) => a.localeCompare(b));
    await writeDb(db);
  }

  return { name };
}

async function upsertSupplier(input) {
  const db = await readDb();
  const id = input.id || createId("sup");
  const existing = db.suppliers.find((supplier) => supplier.id === id);
  const name = String(input.name || "").trim();

  if (!name) {
    const error = new Error("Nome do fornecedor é obrigatório.");
    error.status = 400;
    throw error;
  }

  const duplicated = db.suppliers.find(
    (supplier) => supplier.name.toLowerCase() === name.toLowerCase() && supplier.id !== id
  );
  if (duplicated) {
    const error = new Error("Já existe fornecedor com este nome.");
    error.status = 400;
    throw error;
  }

  const supplier = {
    id,
    name,
    market: String(input.market || "Brasil").trim(),
    kind: String(input.kind || "Candidato").trim(),
    document: String(input.document || "").trim(),
    contact: String(input.contact || "").trim(),
    email: String(input.email || "").trim(),
    phone: String(input.phone || "").trim(),
    website: String(input.website || "").trim(),
    score: Math.max(0, Math.min(100, toNumber(input.score))),
    notes: String(input.notes || "").trim(),
    active: input.active !== false,
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };

  if (existing) {
    Object.assign(existing, supplier);
  } else {
    db.suppliers.push(supplier);
  }

  await writeDb(db);
  return supplier;
}

async function deleteSupplier(id) {
  const db = await readDb();
  const supplier = db.suppliers.find((item) => item.id === id);
  if (!supplier) {
    const error = new Error("Fornecedor não encontrado.");
    error.status = 404;
    throw error;
  }
  supplier.active = false;
  supplier.updatedAt = now();
  await writeDb(db);
  return supplier;
}

async function upsertProduct(input) {
  const db = await readDb();
  const id = input.id || createId("prd");
  const existing = db.products.find((product) => product.id === id);
  const name = String(input.name || "").trim();
  const skuInput = String(input.sku || "").trim();

  if (!name) {
    const error = new Error("Nome do produto é obrigatório.");
    error.status = 400;
    throw error;
  }

  const sku = skuInput || existing?.sku || generateSku(name, db, id);

  if (sku) {
    const duplicatedSku = db.products.find((product) => product.sku === sku && product.id !== id);
    if (duplicatedSku) {
      const error = new Error("Já existe produto com este SKU.");
      error.status = 400;
      throw error;
    }
  }

  const product = {
    id,
    sku,
    name,
    category: String(input.category || "Produto").trim(),
    language: String(input.language || "N/A").trim(),
    supplier: String(input.supplier || "").trim(),
    description: String(input.description || existing?.description || "").trim(),
    imageDataUrl: String(input.imageDataUrl || existing?.imageDataUrl || "").trim(),
    salePrice: input.salePrice !== undefined && input.salePrice !== "" ? clampMoney(input.salePrice) : clampMoney(existing?.salePrice),
    costAvg: clampMoney(input.costAvg),
    stock: Math.max(0, toNumber(input.stock)),
    minStock: Math.max(0, input.minStock !== undefined && input.minStock !== "" ? toNumber(input.minStock) : toNumber(existing?.minStock, 1)),
    active: input.active !== false,
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };

  if (existing) {
    Object.assign(existing, product);
  } else {
    db.products.push(product);
  }

  await writeDb(db);
  return product;
}

async function deleteProduct(id) {
  const db = await readDb();
  const product = getProduct(db, id);
  if (!product) {
    const error = new Error("Produto não encontrado.");
    error.status = 404;
    throw error;
  }
  product.active = false;
  product.updatedAt = now();
  await writeDb(db);
  return product;
}

function findProductForImport(db, item) {
  const sku = normalizeKey(item.sku);
  if (sku) {
    const bySku = db.products.find((product) => normalizeKey(product.sku) === sku);
    if (bySku) return bySku;
  }

  const name = normalizeKey(item.name);
  const language = normalizeKey(item.language || "N/A");
  return db.products.find((product) => normalizeKey(product.name) === name && normalizeKey(product.language || "N/A") === language);
}

async function planProductImport(items, options = {}) {
  const db = await readDb();
  const replaceStock = options.replaceStock !== false;
  const planned = [];
  const errors = [];

  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item.name || "").trim();
    if (!name) {
      errors.push("Produto sem nome encontrado na importação.");
      continue;
    }

    const stock = Math.max(0, toNumber(item.stock));
    const existing = findProductForImport(db, item);
    const currentStock = existing ? toNumber(existing.stock) : 0;
    const nextStock = replaceStock ? stock : currentStock + stock;

    planned.push({
      action: existing ? "update" : "create",
      id: existing?.id || null,
      name,
      sku: String(item.sku || existing?.sku || "").trim(),
      category: String(item.category || existing?.category || "Produto").trim(),
      language: String(item.language || existing?.language || "N/A").trim(),
      supplier: String(item.supplier || existing?.supplier || "").trim(),
      currentStock,
      importedStock: stock,
      nextStock,
      costAvg: clampMoney(item.costAvg),
      salePrice: clampMoney(item.salePrice || existing?.salePrice || 0),
      minStock: Math.max(0, toNumber(item.minStock || existing?.minStock || 1)),
      sourceRows: item.sourceRows || []
    });
  }

  return {
    replaceStock,
    createCount: planned.filter((item) => item.action === "create").length,
    updateCount: planned.filter((item) => item.action === "update").length,
    itemCount: planned.length,
    errors,
    items: planned
  };
}

async function importProductsFromSpreadsheet(items, options = {}) {
  const db = await readDb();
  const replaceStock = options.replaceStock !== false;
  const date = new Date().toISOString().slice(0, 10);
  const imported = [];

  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item.name || "").trim();
    if (!name) continue;

    const existing = findProductForImport(db, item);
    const previousStock = existing ? toNumber(existing.stock) : 0;
    const importedStock = Math.max(0, toNumber(item.stock));
    const nextStock = replaceStock ? importedStock : previousStock + importedStock;
    const id = existing?.id || createId("prd");
    const product = {
      id,
      sku: String(item.sku || existing?.sku || "").trim(),
      name,
      category: String(item.category || existing?.category || "Produto").trim(),
      language: String(item.language || existing?.language || "N/A").trim(),
      supplier: String(item.supplier || existing?.supplier || "").trim(),
      salePrice: clampMoney(item.salePrice || existing?.salePrice || 0),
      costAvg: clampMoney(item.costAvg),
      stock: nextStock,
      minStock: Math.max(0, toNumber(item.minStock || existing?.minStock || 1)),
      active: true,
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };

    if (existing) {
      Object.assign(existing, product);
    } else {
      db.products.push(product);
    }

    const delta = nextStock - previousStock;
    if (delta !== 0) {
      db.movements.push({
        id: createId("mov"),
        date,
        type: "IMPORTAÇÃO",
        productId: id,
        productName: name,
        quantity: delta,
        unitCost: product.costAvg,
        referenceId: "spreadsheet",
        note: replaceStock ? "Estoque substituído por planilha" : "Estoque somado por planilha"
      });
    }

    imported.push({
      action: existing ? "update" : "create",
      id,
      name,
      previousStock,
      nextStock
    });
  }

  await writeDb(db);
  return {
    ok: true,
    replaceStock,
    createCount: imported.filter((item) => item.action === "create").length,
    updateCount: imported.filter((item) => item.action === "update").length,
    itemCount: imported.length,
    items: imported
  };
}

async function createPurchase(input) {
  const db = await readDb();
  const items = Array.isArray(input.items) ? input.items : [];
  const cleanItems = items
    .map((item) => ({
      productId: item.productId,
      quantity: Math.max(0, toNumber(item.quantity)),
      unitCost: clampMoney(item.unitCost)
    }))
    .filter((item) => item.productId && item.quantity > 0);

  if (!cleanItems.length) {
    const error = new Error("Inclua ao menos um item na compra.");
    error.status = 400;
    throw error;
  }

  const subtotal = cleanItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const extraCosts = clampMoney(input.extraCosts);
  const purchaseId = createId("buy");
  const date = input.date || new Date().toISOString().slice(0, 10);
  const supplierName = String(input.supplier || "").trim();

  const finalItems = cleanItems.map((item) => {
    const product = getProduct(db, item.productId);
    if (!product) {
      const error = new Error("Produto da compra não encontrado.");
      error.status = 400;
      throw error;
    }

    const share = subtotal > 0 ? (item.quantity * item.unitCost) / subtotal : 0;
    const allocatedExtra = extraCosts * share;
    const finalUnitCost = clampMoney(item.unitCost + allocatedExtra / item.quantity);
    const previousStock = toNumber(product.stock);
    const previousCost = toNumber(product.costAvg);
    const newStock = previousStock + item.quantity;
    const newAverage = newStock > 0
      ? clampMoney(((previousStock * previousCost) + (item.quantity * finalUnitCost)) / newStock)
      : finalUnitCost;

    product.stock = newStock;
    product.costAvg = newAverage;
    product.updatedAt = now();

    db.movements.push({
      id: createId("mov"),
      date,
      type: "COMPRA",
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitCost: finalUnitCost,
      referenceId: purchaseId,
      note: `Compra de ${supplierName || "fornecedor"}`
    });

    return {
      ...item,
      productName: product.name,
      allocatedExtra: clampMoney(allocatedExtra),
      finalUnitCost,
      total: clampMoney(item.quantity * finalUnitCost)
    };
  });

  const purchase = {
    id: purchaseId,
    date,
    supplier: supplierName,
    invoice: String(input.invoice || "").trim(),
    notes: String(input.notes || "").trim(),
    items: finalItems,
    subtotal: clampMoney(subtotal),
    extraCosts,
    total: clampMoney(subtotal + extraCosts),
    createdAt: now()
  };

  db.purchases.unshift(purchase);
  await writeDb(db);
  return purchase;
}

async function createSale(input) {
  const db = await readDb();
  const items = Array.isArray(input.items) ? input.items : [];
  const cleanItems = items
    .map((item) => ({
      productId: item.productId,
      quantity: Math.max(0, toNumber(item.quantity)),
      unitPrice: clampMoney(item.unitPrice)
    }))
    .filter((item) => item.productId && item.quantity > 0);

  if (!cleanItems.length) {
    const error = new Error("Inclua ao menos um item na venda.");
    error.status = 400;
    throw error;
  }

  for (const item of cleanItems) {
    const product = getProduct(db, item.productId);
    if (!product) {
      const error = new Error("Produto da venda não encontrado.");
      error.status = 400;
      throw error;
    }
    if (toNumber(product.stock) < item.quantity) {
      const error = new Error(`Estoque insuficiente para ${product.name}.`);
      error.status = 400;
      throw error;
    }
  }

  const saleId = createId("sal");
  const date = input.date || new Date().toISOString().slice(0, 10);
  const finalItems = cleanItems.map((item) => {
    const product = getProduct(db, item.productId);
    const unitCost = clampMoney(product.costAvg);
    product.stock = toNumber(product.stock) - item.quantity;
    product.updatedAt = now();

    db.movements.push({
      id: createId("mov"),
      date,
      type: "VENDA",
      productId: product.id,
      productName: product.name,
      quantity: -item.quantity,
      unitCost,
      referenceId: saleId,
      note: `Venda para ${input.customer || "cliente"}`
    });

    return {
      ...item,
      productName: product.name,
      unitCost,
      revenue: clampMoney(item.quantity * item.unitPrice),
      cost: clampMoney(item.quantity * unitCost)
    };
  });

  const grossRevenue = finalItems.reduce((sum, item) => sum + item.revenue, 0);
  const costTotal = finalItems.reduce((sum, item) => sum + item.cost, 0);
  const discount = clampMoney(input.discount);
  const shippingCharged = clampMoney(input.shippingCharged);
  const fees = clampMoney(input.fees);
  const netRevenue = clampMoney(grossRevenue - discount + shippingCharged);
  const profit = clampMoney(netRevenue - costTotal - fees);
  const margin = netRevenue > 0 ? clampMoney((profit / netRevenue) * 100) : 0;

  const sale = {
    id: saleId,
    date,
    customer: String(input.customer || "").trim(),
    channel: String(input.channel || "Balcão").trim(),
    paymentMethod: String(input.paymentMethod || "").trim(),
    paymentStatus: String(input.paymentStatus || "Pago").trim(),
    orderStatus: String(input.orderStatus || "Recebido").trim(),
    trackingCode: String(input.trackingCode || "").trim(),
    trackingUrl: String(input.trackingUrl || "").trim(),
    notes: String(input.notes || "").trim(),
    items: finalItems,
    grossRevenue: clampMoney(grossRevenue),
    discount,
    shippingCharged,
    fees,
    netRevenue,
    costTotal: clampMoney(costTotal),
    profit,
    margin,
    createdAt: now()
  };

  db.sales.unshift(sale);
  await writeDb(db);
  return sale;
}

async function updateSale(id, input) {
  const db = await readDb();
  const sale = db.sales.find((item) => item.id === id);
  if (!sale) {
    const error = new Error("Pedido não encontrado.");
    error.status = 404;
    throw error;
  }

  if (input.paymentStatus !== undefined) sale.paymentStatus = String(input.paymentStatus || "").trim();
  if (input.orderStatus !== undefined) sale.orderStatus = String(input.orderStatus || "").trim();
  if (input.trackingCode !== undefined) sale.trackingCode = String(input.trackingCode || "").trim();
  if (input.trackingUrl !== undefined) sale.trackingUrl = String(input.trackingUrl || "").trim();
  if (input.notes !== undefined) sale.notes = String(input.notes || "").trim();
  sale.updatedAt = now();

  await writeDb(db);
  return sale;
}

async function createLead(input) {
  const db = await readDb();
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim();
  const phone = String(input.phone || "").trim();
  const password = String(input.password || "");
  if (!name || (!email && !phone)) {
    const error = new Error("Informe nome e pelo menos e-mail ou celular.");
    error.status = 400;
    throw error;
  }
  if (input.requirePassword && password.length < 6) {
    const error = new Error("Informe uma senha com pelo menos 6 caracteres.");
    error.status = 400;
    throw error;
  }

  const existing = db.leads.find((item) => {
    const sameEmail = email && String(item.email || "").toLowerCase() === email.toLowerCase();
    const samePhone = phone && String(item.phone || "").replace(/\D/g, "") === phone.replace(/\D/g, "");
    return sameEmail || samePhone;
  });

  if (existing) {
    if (input.requirePassword && existing.passwordHash && !input.allowUpdate) {
      const error = new Error("Ja existe uma conta com este e-mail ou celular.");
      error.status = 409;
      throw error;
    }
    Object.assign(existing, {
      name,
      email,
      phone,
      zipCode: String(input.zipCode || "").trim(),
      street: String(input.street || "").trim(),
      number: String(input.number || "").trim(),
      complement: String(input.complement || "").trim(),
      neighborhood: String(input.neighborhood || "").trim(),
      city: String(input.city || "").trim(),
      state: String(input.state || "").trim(),
      source: String(input.source || existing.source || "Site").trim(),
      updatedAt: now()
    });
    if (password) existing.passwordHash = hashPassword(password);
    await writeDb(db);
    return publicCustomer(existing);
  }

  const lead = {
    id: createId("lead"),
    name,
    email,
    phone,
    zipCode: String(input.zipCode || "").trim(),
    street: String(input.street || "").trim(),
    number: String(input.number || "").trim(),
    complement: String(input.complement || "").trim(),
    neighborhood: String(input.neighborhood || "").trim(),
    city: String(input.city || "").trim(),
    state: String(input.state || "").trim(),
    source: String(input.source || "Site").trim(),
    passwordHash: password ? hashPassword(password) : "",
    createdAt: now()
  };

  db.leads.unshift(lead);
  await writeDb(db);
  return publicCustomer(lead);
}

async function loginCustomer(input) {
  const db = await readDb();
  const login = String(input.login || "").trim().toLowerCase();
  const phoneLogin = login.replace(/\D/g, "");
  const password = String(input.password || "");
  const customer = db.leads.find((item) => {
    const email = String(item.email || "").trim().toLowerCase();
    const phone = String(item.phone || "").replace(/\D/g, "");
    return (login && email === login) || (phoneLogin && phone === phoneLogin);
  });

  if (!customer || !customer.passwordHash || customer.passwordHash !== hashPassword(password)) {
    const error = new Error("Login ou senha invalidos.");
    error.status = 401;
    throw error;
  }

  return publicCustomer(customer);
}

async function getSummary() {
  const db = await readDb();
  const activeProducts = db.products.filter((product) => product.active !== false);
  const activeSuppliers = db.suppliers.filter((supplier) => supplier.active !== false);
  const totalStockUnits = activeProducts.reduce((sum, product) => sum + toNumber(product.stock), 0);
  const stockValue = activeProducts.reduce((sum, product) => sum + toNumber(product.stock) * toNumber(product.costAvg), 0);
  const revenue = db.sales.reduce((sum, sale) => sum + toNumber(sale.netRevenue), 0);
  const profit = db.sales.reduce((sum, sale) => sum + toNumber(sale.profit), 0);
  const purchases = db.purchases.reduce((sum, purchase) => sum + toNumber(purchase.total), 0);
  const lowStock = activeProducts.filter((product) => toNumber(product.stock) <= toNumber(product.minStock));

  return {
    revenue: clampMoney(revenue),
    profit: clampMoney(profit),
    purchases: clampMoney(purchases),
    stockValue: clampMoney(stockValue),
    totalStockUnits,
    activeProducts: activeProducts.length,
    activeSuppliers: activeSuppliers.length,
    saleCount: db.sales.length,
    lowStockCount: lowStock.length,
    lowStock
  };
}

module.exports = {
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
  updateSale,
  createLead,
  loginCustomer,
  defaultStoreCategories,
  getSummary
};
