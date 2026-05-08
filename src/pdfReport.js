const zlib = require("zlib");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const LINE_HEIGHT = 15;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfString(value) {
  return `(${normalizeText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

function wrapText(text, maxChars) {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function estimateTextWidth(value, size = 10, font = "F1") {
  const factor = font === "F3" || font === "F4" ? 0.6 : 0.52;
  return normalizeText(value).length * size * factor;
}

function clientPrice(product) {
  const salePrice = toNumber(product.salePrice);
  return salePrice > 0 ? money(salePrice) : "Não cadastrado";
}

function parseJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function parsePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.slice(0, 8).toString("hex") !== signature) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (!width || !height || !idat.length || ![2, 6].includes(colorType)) return null;
  const channels = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let inputOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.slice(inputOffset, inputOffset + stride));
    inputOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      let value = row[x];
      if (filter === 1) value = (value + left) & 255;
      if (filter === 2) value = (value + up) & 255;
      if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
      if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (value + predictor) & 255;
      }
      row[x] = value;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const alpha = channels === 4 ? row[source + 3] / 255 : 1;
      rgb[outputOffset] = Math.round((row[source] * alpha) + (255 * (1 - alpha)));
      rgb[outputOffset + 1] = Math.round((row[source + 1] * alpha) + (255 * (1 - alpha)));
      rgb[outputOffset + 2] = Math.round((row[source + 2] * alpha) + (255 * (1 - alpha)));
      outputOffset += 3;
    }
    previous = row;
  }

  return {
    width,
    height,
    colorSpace: "/DeviceRGB",
    filter: "/FlateDecode",
    data: zlib.deflateSync(rgb)
  };
}

function imageFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (mime.includes("jpeg") || mime.includes("jpg")) {
    const size = parseJpegSize(buffer);
    if (!size) return null;
    return {
      ...size,
      colorSpace: "/DeviceRGB",
      filter: "/DCTDecode",
      data: buffer
    };
  }
  return parsePng(buffer);
}

class PdfDocument {
  constructor() {
    this.pages = [];
    this.images = [];
    this.current = null;
    this.y = 0;
    this.addPage();
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(height) {
    if (this.y - height < MARGIN + 24) this.addPage();
  }

  text(value, x, y, size = 10, font = "F1") {
    this.current.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(value)} Tj ET`);
  }

  textRight(value, rightX, y, size = 10, font = "F1") {
    this.text(value, rightX - estimateTextWidth(value, size, font), y, size, font);
  }

  line(x1, y1, x2, y2) {
    this.current.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rect(x, y, width, height, shade = 0.94) {
    this.current.push(`${shade} g ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f 0 g`);
  }

  addImage(image) {
    if (!image) return null;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ ...image, name });
    return name;
  }

  image(name, x, y, width, height) {
    if (!name) return;
    this.current.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`);
  }

  keyValue(label, value, x, y) {
    this.text(label, x, y, 8, "F1");
    this.text(value, x, y - 13, 12, "F2");
  }
}

function buildPdf(pages, images = []) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    ""
  ];
  const pageObjectIds = [];
  const contentObjectIds = [];

  for (const pageContent of pages) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    contentObjectIds.push(contentId);
    objects.push("");
    objects.push("");
  }

  const imageObjectIds = images.map(() => {
    const objectId = objects.length + 1;
    objects.push("");
    return objectId;
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  pageObjectIds.forEach((pageId, index) => {
    const contentId = contentObjectIds[index];
    const xObjects = images.length
      ? ` /XObject << ${images.map((image, imageIndex) => `/${image.name} ${imageObjectIds[imageIndex]} 0 R`).join(" ")} >>`
      : "";
    objects[pageId - 1] = [
      "<< /Type /Page",
      "/Parent 2 0 R",
      `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
      `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> /F3 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> /F4 << /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >> >>${xObjects} >>`,
      `/Contents ${contentId} 0 R`,
      ">>"
    ].join(" ");
    const stream = `${pages[index].join("\n")}\n`;
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`;
  });

  images.forEach((image, index) => {
    const imageObjectId = imageObjectIds[index];
    objects[imageObjectId - 1] = [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`,
      `/ColorSpace ${image.colorSpace} /BitsPerComponent 8 /Filter ${image.filter}`,
      `/Length ${image.data.length} >>`,
      "stream",
      image.data.toString("latin1"),
      "endstream"
    ].join("\n");
  });

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(chunks.join(""), "latin1"));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefStart = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return Buffer.from(chunks.join(""), "latin1");
}

function generateClientStockPdf(db, options = {}) {
  const generatedAt = options.generatedAt || new Date();
  const products = (db.products || [])
    .filter((product) => product.active !== false && toNumber(product.stock) > 0)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const doc = new PdfDocument();
  const date = generatedAt.toLocaleDateString("pt-BR");
  const logoName = doc.addImage(imageFromDataUrl(db.meta?.logoDataUrl));
  const logoSize = 58;

  if (logoName) doc.image(logoName, MARGIN, doc.y - logoSize + 6, logoSize, logoSize);
  doc.text("Scaff TCG", logoName ? MARGIN + logoSize + 16 : MARGIN, doc.y - 10, 24, "F2");
  doc.text(`Tabela de preços - ${date}`, logoName ? MARGIN + logoSize + 16 : MARGIN, doc.y - 30, 10, "F1");
  doc.y -= 78;

  doc.rect(MARGIN, doc.y - 6, RIGHT_EDGE - MARGIN, 20, 0.91);
  doc.text("Produto", MARGIN + 64, doc.y, 9, "F4");
  doc.textRight("Preço", RIGHT_EDGE - 8, doc.y, 9, "F4");
  doc.y -= 22;

  if (!products.length) {
    doc.text("Nenhum produto disponível no momento.", MARGIN + 8, doc.y, 10, "F1");
  }

  products.forEach((product, index) => {
    const imageName = doc.addImage(imageFromDataUrl(product.imageDataUrl));
    const nameLines = wrapText(product.name || "-", 56).slice(0, 3);
    const rowHeight = Math.max(54, nameLines.length * LINE_HEIGHT);
    doc.ensureSpace(rowHeight + 10);
    if (index % 2 === 0) doc.rect(MARGIN, doc.y - rowHeight + 8, RIGHT_EDGE - MARGIN, rowHeight + 8, 0.97);

    if (imageName) {
      doc.image(imageName, MARGIN + 8, doc.y - 42, 42, 42);
    } else {
      doc.rect(MARGIN + 8, doc.y - 42, 42, 42, 0.92);
      doc.text("Foto", MARGIN + 18, doc.y - 24, 7, "F1");
    }
    nameLines.forEach((line, index) => {
      doc.text(line, MARGIN + 64, doc.y - (index * LINE_HEIGHT), 9, index === 0 ? "F4" : "F3");
    });
    doc.textRight(clientPrice(product), RIGHT_EDGE - 8, doc.y, 9, "F3");
    doc.y -= rowHeight + 6;
  });

  doc.pages.forEach((page, index) => {
    page.push(`BT /F1 8 Tf ${MARGIN.toFixed(2)} 28.00 Td ${pdfString("Scaff TCG")} Tj ET`);
    page.push(`BT /F1 8 Tf ${(PAGE_WIDTH - MARGIN - 58).toFixed(2)} 28.00 Td ${pdfString(`Página ${index + 1}/${doc.pages.length}`)} Tj ET`);
  });

  return buildPdf(doc.pages, doc.images);
}

module.exports = {
  generateClientStockPdf
};
