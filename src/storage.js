const fs = require("fs");
const path = require("path");

const now = () => new Date().toISOString();
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
  movements: []
});

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveDataFile() {
  return path.resolve(process.cwd(), process.env.DATA_FILE || "./data/db.json");
}

function readDb() {
  const file = resolveDataFile();
  ensureDir(file);

  if (!fs.existsSync(file)) {
    const db = initialDb();
    writeDb(db);
    return db;
  }

  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return initialDb();

  const db = JSON.parse(raw);
  return {
    ...initialDb(),
    ...db,
    meta: { ...initialDb().meta, ...db.meta },
    products: db.products || [],
    suppliers: db.suppliers || [],
    categories: db.categories || [],
    purchases: db.purchases || [],
    sales: db.sales || [],
    movements: db.movements || []
  };
}

function writeDb(db) {
  const file = resolveDataFile();
  ensureDir(file);
  const next = {
    ...db,
    meta: {
      ...(db.meta || {}),
      app: "loja-erp",
      version: 1,
      updatedAt: now()
    }
  };
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

function getCategories() {
  const db = readDb();
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

function addCategory(input) {
  const db = readDb();
  const name = String(input.name || input.category || "").trim();
  if (!name) {
    const error = new Error("Nome da categoria e obrigatorio.");
    error.status = 400;
    throw error;
  }

  const exists = getCategories().some((category) => normalizeKey(category) === normalizeKey(name));
  if (!exists) {
    db.categories = [...(db.categories || []), name].sort((a, b) => a.localeCompare(b));
    writeDb(db);
  }

  return { name };
}

function upsertSupplier(input) {
  const db = readDb();
  const id = input.id || createId("sup");
  const existing = db.suppliers.find((supplier) => supplier.id === id);
  const name = String(input.name || "").trim();

  if (!name) {
    const error = new Error("Nome do fornecedor e obrigatorio.");
    error.status = 400;
    throw error;
  }

  const duplicated = db.suppliers.find(
    (supplier) => supplier.name.toLowerCase() === name.toLowerCase() && supplier.id !== id
  );
  if (duplicated) {
    const error = new Error("Ja existe fornecedor com este nome.");
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

  writeDb(db);
  return supplier;
}

function deleteSupplier(id) {
  const db = readDb();
  const supplier = db.suppliers.find((item) => item.id === id);
  if (!supplier) {
    const error = new Error("Fornecedor nao encontrado.");
    error.status = 404;
    throw error;
  }
  supplier.active = false;
  supplier.updatedAt = now();
  writeDb(db);
  return supplier;
}

function upsertProduct(input) {
  const db = readDb();
  const id = input.id || createId("prd");
  const existing = db.products.find((product) => product.id === id);
  const name = String(input.name || "").trim();
  const skuInput = String(input.sku || "").trim();

  if (!name) {
    const error = new Error("Nome do produto e obrigatorio.");
    error.status = 400;
    throw error;
  }

  const sku = skuInput || existing?.sku || generateSku(name, db, id);

  if (sku) {
    const duplicatedSku = db.products.find((product) => product.sku === sku && product.id !== id);
    if (duplicatedSku) {
      const error = new Error("Ja existe produto com este SKU.");
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

  writeDb(db);
  return product;
}

function deleteProduct(id) {
  const db = readDb();
  const product = getProduct(db, id);
  if (!product) {
    const error = new Error("Produto nao encontrado.");
    error.status = 404;
    throw error;
  }
  product.active = false;
  product.updatedAt = now();
  writeDb(db);
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

function planProductImport(items, options = {}) {
  const db = readDb();
  const replaceStock = options.replaceStock !== false;
  const planned = [];
  const errors = [];

  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item.name || "").trim();
    if (!name) {
      errors.push("Produto sem nome encontrado na importacao.");
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

function importProductsFromSpreadsheet(items, options = {}) {
  const db = readDb();
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
        type: "IMPORTACAO",
        productId: id,
        productName: name,
        quantity: delta,
        unitCost: product.costAvg,
        referenceId: "spreadsheet",
        note: replaceStock ? "Estoque substituido por planilha" : "Estoque somado por planilha"
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

  writeDb(db);
  return {
    ok: true,
    replaceStock,
    createCount: imported.filter((item) => item.action === "create").length,
    updateCount: imported.filter((item) => item.action === "update").length,
    itemCount: imported.length,
    items: imported
  };
}

function createPurchase(input) {
  const db = readDb();
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
      const error = new Error("Produto da compra nao encontrado.");
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
  writeDb(db);
  return purchase;
}

function createSale(input) {
  const db = readDb();
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
      const error = new Error("Produto da venda nao encontrado.");
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
    channel: String(input.channel || "Balcao").trim(),
    paymentMethod: String(input.paymentMethod || "").trim(),
    paymentStatus: String(input.paymentStatus || "Pago").trim(),
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
  writeDb(db);
  return sale;
}

function getSummary() {
  const db = readDb();
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
  getSummary
};
