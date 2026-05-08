const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
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

function countItems(db) {
  return {
    products: Array.isArray(db.products) ? db.products.length : 0,
    suppliers: Array.isArray(db.suppliers) ? db.suppliers.length : 0,
    categories: Array.isArray(db.categories) ? db.categories.length : 0,
    purchases: Array.isArray(db.purchases) ? db.purchases.length : 0,
    sales: Array.isArray(db.sales) ? db.sales.length : 0,
    movements: Array.isArray(db.movements) ? db.movements.length : 0
  };
}

async function main() {
  loadDotEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("Defina DATABASE_URL antes de migrar para Postgres.");
  }

  const dataFile = path.resolve(
    process.cwd(),
    process.env.MIGRATION_DATA_FILE || process.env.DATA_FILE || "./data/db.json"
  );

  if (!fs.existsSync(dataFile)) {
    throw new Error(`Arquivo de dados nao encontrado: ${dataFile}`);
  }

  const raw = fs.readFileSync(dataFile, "utf8").trim();
  if (!raw) {
    throw new Error(`Arquivo de dados vazio: ${dataFile}`);
  }

  const db = JSON.parse(raw);
  const { writeDb } = require("../src/storage");
  await writeDb(db);

  const counts = countItems(db);
  console.log("Migracao concluida para Postgres.");
  console.log(`Produtos: ${counts.products}`);
  console.log(`Fornecedores: ${counts.suppliers}`);
  console.log(`Categorias: ${counts.categories}`);
  console.log(`Compras: ${counts.purchases}`);
  console.log(`Vendas: ${counts.sales}`);
  console.log(`Movimentacoes: ${counts.movements}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
