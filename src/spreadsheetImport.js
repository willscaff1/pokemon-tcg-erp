const zlib = require("zlib");

const PRODUCT_HEADERS = ["produto", "nome", "nome produto", "descricao", "descrição", "item"];
const SKU_HEADERS = ["sku", "codigo", "código", "cod", "referencia", "referência"];
const COST_HEADERS = ["pago", "custo", "preco pago", "preço pago", "valor pago", "custo unitario", "custo unitário", "preco compra", "preço compra"];
const SALE_HEADERS = ["vendido", "venda", "preco venda", "preço venda", "valor vendido", "valor venda", "preco vendido", "preço vendido"];
const QTY_HEADERS = ["qtd", "quantidade", "estoque", "unidades", "qtde"];
const CATEGORY_HEADERS = ["categoria", "tipo"];
const SUPPLIER_HEADERS = ["fornecedor", "distribuidor", "origem"];
const VARIATION_HEADERS = ["variacao", "variação", "idioma", "lingua", "língua", "modelo"];
const IGNORED_CALCULATED_HEADERS = ["lucro", "lucro%"];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

function parseXmlAttrs(raw) {
  const attrs = {};
  const pattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(raw))) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function colIndex(cellRef) {
  const letters = String(cellRef || "").match(/[A-Z]+/i)?.[0] || "";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return Math.max(0, index - 1);
}

function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[R$\s]/g, "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseQuantity(value, fallback = 1) {
  const parsed = parseMoney(value);
  return parsed > 0 ? parsed : fallback;
}

function findHeader(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function readZipEntries(buffer) {
  const signature = 0x06054b50;
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === signature) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("Arquivo XLSX invalido: diretorio ZIP nao encontrado.");

  const totalEntries = buffer.readUInt16LE(end + 10);
  const centralOffset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  let offset = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Arquivo XLSX invalido: entrada ZIP corrompida.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  function read(name) {
    const entry = entries.get(name);
    if (!entry) return "";
    const localOffset = entry.localOffset;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Arquivo XLSX invalido: cabecalho local ausente em ${name}.`);
    }
    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + fileNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return compressed.toString("utf8");
    if (entry.method === 8) return zlib.inflateRawSync(compressed).toString("utf8");
    throw new Error(`Metodo de compressao nao suportado no XLSX: ${entry.method}.`);
  }

  return { entries, read };
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si;
  while ((si = siPattern.exec(xml))) {
    const parts = [];
    const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let text;
    while ((text = textPattern.exec(si[1]))) {
      parts.push(decodeXml(text[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function getFirstSheet(zip) {
  const workbookXml = zip.read("xl/workbook.xml");
  const relsXml = zip.read("xl/_rels/workbook.xml.rels");
  const sheetMatch = workbookXml.match(/<sheet\b([^>]*)\/?>/);
  if (!sheetMatch) return { name: "Sheet1", path: "xl/worksheets/sheet1.xml" };

  const attrs = parseXmlAttrs(sheetMatch[1]);
  const relId = attrs["r:id"];
  let target = "worksheets/sheet1.xml";
  const relPattern = /<Relationship\b([^>]*)\/?>/g;
  let rel;
  while ((rel = relPattern.exec(relsXml))) {
    const relAttrs = parseXmlAttrs(rel[1]);
    if (relAttrs.Id === relId) {
      target = relAttrs.Target;
      break;
    }
  }

  return {
    name: attrs.name || "Sheet1",
    path: `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`
  };
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const row = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const attrs = parseXmlAttrs(cellMatch[1]);
      const index = colIndex(attrs.r);
      const body = cellMatch[2];
      const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      let value = valueMatch ? decodeXml(valueMatch[1]) : "";

      if (attrs.t === "s") value = sharedStrings[Number(value)] || "";
      else if (attrs.t === "inlineStr") value = decodeXml(body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] || "");
      else if (attrs.t !== "str" && value !== "") {
        const number = Number(value);
        value = Number.isFinite(number) ? number : value;
      }
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvRows(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolons >= commas ? ";" : ",";
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function extractRows(fileName, buffer) {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".csv")) {
    return { sheetName: "CSV", rows: parseCsvRows(buffer.toString("utf8")) };
  }
  if (!lower.endsWith(".xlsx")) {
    throw new Error("Formato nao suportado. Envie .xlsx ou .csv.");
  }
  const zip = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(zip.read("xl/sharedStrings.xml"));
  const sheet = getFirstSheet(zip);
  return {
    sheetName: sheet.name,
    rows: parseSheetRows(zip.read(sheet.path), sharedStrings)
  };
}

function extractProductsFromSpreadsheet(fileName, buffer) {
  const { sheetName, rows } = extractRows(fileName, buffer);
  const warnings = [];
  const errors = [];

  const headerRowIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeText);
    return findHeader(headers, PRODUCT_HEADERS) >= 0 && findHeader(headers, COST_HEADERS) >= 0;
  });
  if (headerRowIndex === -1) {
    throw new Error("Nao encontrei cabecalho com as colunas Produto e Pago/Custo.");
  }

  const headerValues = rows[headerRowIndex].map((cell) => String(cell || "").trim());
  const headers = headerValues.map(normalizeText);
  const columns = {
    product: findHeader(headers, PRODUCT_HEADERS),
    sku: findHeader(headers, SKU_HEADERS),
    cost: findHeader(headers, COST_HEADERS),
    sale: findHeader(headers, SALE_HEADERS),
    quantity: findHeader(headers, QTY_HEADERS),
    category: findHeader(headers, CATEGORY_HEADERS),
    supplier: findHeader(headers, SUPPLIER_HEADERS),
    variation: findHeader(headers, VARIATION_HEADERS)
  };

  if (columns.sale === -1) warnings.push("Coluna Vendido/Preco venda nao encontrada; preco de venda ficara 0 nos novos produtos.");
  if (columns.quantity === -1) warnings.push("Coluna Quantidade nao encontrada; cada linha valida sera importada como 1 unidade.");
  if (headers.some((header) => IGNORED_CALCULATED_HEADERS.includes(header))) {
    warnings.push("Colunas Lucro e Lucro% foram ignoradas; o sistema calcula esses valores pelas vendas lancadas.");
  }

  const grouped = new Map();
  let skippedRows = 0;
  const dataRows = rows.slice(headerRowIndex + 1);

  dataRows.forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const name = String(row[columns.product] || "").trim();
    if (!name) {
      skippedRows += 1;
      return;
    }

    const quantity = columns.quantity >= 0 ? parseQuantity(row[columns.quantity], 0) : 1;
    if (quantity <= 0) {
      skippedRows += 1;
      errors.push(`Linha ${rowNumber}: quantidade invalida.`);
      return;
    }

    const sku = columns.sku >= 0 ? String(row[columns.sku] || "").trim() : "";
    const variation = columns.variation >= 0 ? String(row[columns.variation] || "N/A").trim() : "N/A";
    const key = normalizeText(sku || `${name} ${variation}`);
    const cost = parseMoney(row[columns.cost]);
    const salePrice = columns.sale >= 0 ? parseMoney(row[columns.sale]) : 0;
    const existing = grouped.get(key);

    if (existing) {
      existing.stock += quantity;
      existing.totalCost += cost * quantity;
      if (salePrice > 0) existing.salePrice = salePrice;
      existing.sourceRows.push(rowNumber);
    } else {
      grouped.set(key, {
        sku,
        name,
        category: columns.category >= 0 ? String(row[columns.category] || "Produto").trim() || "Produto" : "Produto",
        language: variation || "N/A",
        supplier: columns.supplier >= 0 ? String(row[columns.supplier] || "").trim() : "",
        stock: quantity,
        totalCost: cost * quantity,
        salePrice,
        minStock: 1,
        sourceRows: [rowNumber]
      });
    }
  });

  const products = [...grouped.values()].map((item) => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    language: item.language,
    supplier: item.supplier,
    stock: item.stock,
    costAvg: item.stock > 0 ? Math.round((item.totalCost / item.stock) * 100) / 100 : 0,
    salePrice: Math.round(item.salePrice * 100) / 100,
    minStock: item.minStock,
    sourceRows: item.sourceRows
  }));

  return {
    sheetName,
    headerRow: headerRowIndex + 1,
    columns: Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, value >= 0 ? headerValues[value] : null])),
    products,
    rowsRead: dataRows.length,
    skippedRows,
    warnings,
    errors
  };
}

module.exports = {
  extractProductsFromSpreadsheet
};
