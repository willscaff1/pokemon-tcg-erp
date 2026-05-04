const state = {
  products: [],
  suppliers: [],
  categories: [],
  purchases: [],
  sales: [],
  movements: [],
  summary: {},
  spreadsheetImport: null
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatMoney(value) {
  return money.format(Number(value || 0));
}

function parseMoneyInput(value) {
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro na requisicao.");
  return data;
}

function getFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function productOptions(selected = "") {
  const active = state.products.filter((product) => product.active !== false);
  return [
    '<option value="">Selecione</option>',
    ...active.map((product) => `
      <option value="${product.id}" ${product.id === selected ? "selected" : ""}>
        ${product.name} | estoque ${product.stock}
      </option>
    `)
  ].join("");
}

function selectedProduct(id) {
  return state.products.find((product) => product.id === id);
}

function itemRow(type) {
  const priceName = type === "sale" ? "unitPrice" : "unitCost";
  const priceLabel = type === "sale" ? "Preco unit." : "Custo unit.";
  return `
    <div class="item-row">
      <label>Produto
        <select name="productId">${productOptions()}</select>
      </label>
      <label>Qtd
        <input name="quantity" type="number" min="1" step="1" value="1">
      </label>
      <label>${priceLabel}
        <input name="${priceName}" type="number" min="0" step="0.01" value="0">
      </label>
      <button class="remove" type="button" title="Remover">X</button>
    </div>
  `;
}

function setupItemEvents(container, calculator, type) {
  container.querySelectorAll(".remove").forEach((button) => {
    button.onclick = () => {
      button.closest(".item-row").remove();
      calculator();
    };
  });
  container.querySelectorAll("input, select").forEach((input) => {
    input.oninput = () => {
      if (type === "sale" && input.name === "productId") {
        const row = input.closest(".item-row");
        const product = selectedProduct(input.value);
        if (product) row.querySelector('input[name="unitPrice"]').value = product.salePrice || 0;
      }
      calculator();
    };
  });
}

function collectItems(container, priceName) {
  return [...container.querySelectorAll(".item-row")].map((row) => ({
    productId: row.querySelector('[name="productId"]').value,
    quantity: Number(row.querySelector('[name="quantity"]').value || 0),
    [priceName]: Number(row.querySelector(`[name="${priceName}"]`).value || 0)
  })).filter((item) => item.productId && item.quantity > 0);
}

async function loadAll() {
  const [summary, products, suppliers, categories, purchases, sales, movements] = await Promise.all([
    api("/api/summary"),
    api("/api/products"),
    api("/api/suppliers"),
    api("/api/categories"),
    api("/api/purchases"),
    api("/api/sales"),
    api("/api/movements")
  ]);
  state.summary = summary;
  state.products = products;
  state.suppliers = suppliers;
  state.categories = categories;
  state.purchases = purchases;
  state.sales = sales;
  state.movements = movements;
  renderAll();
}

function renderAll() {
  renderDashboard();
  renderProducts();
  renderSuppliers();
  renderHistories();
  renderSupplierOptions();
  renderProductFormOptions();
  renderProductFilters();
  refreshItemSelects();
  calculatePurchaseTotal();
  calculateSaleTotal();
}

function renderDashboard() {
  document.getElementById("revenue").textContent = formatMoney(state.summary.revenue);
  document.getElementById("profit").textContent = formatMoney(state.summary.profit);
  document.getElementById("stockValue").textContent = formatMoney(state.summary.stockValue);
  document.getElementById("stockUnits").textContent = state.summary.totalStockUnits || 0;

  const lowStock = document.getElementById("lowStock");
  lowStock.innerHTML = (state.summary.lowStock || []).length
    ? state.summary.lowStock.map((product) => `
      <div class="row-card">
        <strong>${product.name}</strong>
        <span>Estoque ${product.stock} | minimo ${product.minStock}</span>
      </div>
    `).join("")
    : '<div class="row-card"><strong>Nenhum produto abaixo do minimo.</strong><span>Cadastre estoque minimo para acompanhar reposicao.</span></div>';

  document.getElementById("recentSales").innerHTML = state.sales.slice(0, 6).map((sale) => `
    <div class="row-card">
      <strong>${sale.customer || "Cliente"} - ${formatMoney(sale.netRevenue)}</strong>
      <span>${sale.date} | ${sale.channel} | lucro ${formatMoney(sale.profit)} (${sale.margin}%)</span>
    </div>
  `).join("") || '<div class="row-card"><strong>Nenhuma venda lancada.</strong><span>As ultimas vendas vao aparecer aqui.</span></div>';

  renderSalesReport();
}

function calculateAverageMargin() {
  if (!state.sales.length) return 0;
  const margin = state.sales.reduce((sum, sale) => sum + Number(sale.margin || 0), 0) / state.sales.length;
  return Math.round(margin * 100) / 100;
}

function calculateAverageTicket() {
  if (!state.sales.length) return 0;
  return state.sales.reduce((sum, sale) => sum + Number(sale.netRevenue || 0), 0) / state.sales.length;
}

function renderSalesReport() {
  const totalSales = state.sales.length;
  const revenue = state.sales.reduce((sum, sale) => sum + Number(sale.netRevenue || 0), 0);
  const profit = state.sales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const cost = state.sales.reduce((sum, sale) => sum + Number(sale.costTotal || 0), 0);
  const fees = state.sales.reduce((sum, sale) => sum + Number(sale.fees || 0), 0);
  const avgMargin = calculateAverageMargin();
  const profitRate = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;

  document.getElementById("salesReport").innerHTML = `
    <div class="report-card"><span>Vendas</span><strong>${totalSales}</strong></div>
    <div class="report-card"><span>Margem media</span><strong>${avgMargin}%</strong></div>
    <div class="report-card"><span>Lucro / faturamento</span><strong>${profitRate}%</strong></div>
    <div class="report-card"><span>Ticket medio</span><strong>${formatMoney(calculateAverageTicket())}</strong></div>
    <div class="report-card"><span>Custo vendido</span><strong>${formatMoney(cost)}</strong></div>
    <div class="report-card"><span>Taxas</span><strong>${formatMoney(fees)}</strong></div>
  `;

  document.getElementById("salesReportRows").innerHTML = state.sales.slice(0, 10).map((sale) => `
    <div class="row-card">
      <strong>${sale.date} | ${formatMoney(sale.netRevenue)} | margem ${sale.margin}%</strong>
      <span>Lucro ${formatMoney(sale.profit)} | custo ${formatMoney(sale.costTotal)} | taxas ${formatMoney(sale.fees)} | ${sale.items.map((item) => item.productName).join(", ")}</span>
    </div>
  `).join("") || '<div class="row-card"><strong>Nenhuma venda para relatorio.</strong><span>Quando vender pelo botao Vender, os dados aparecem aqui.</span></div>';
}

function renderProducts() {
  const q = document.getElementById("productSearch").value.toLowerCase().trim();
  const category = document.getElementById("categoryFilter").value;
  const sort = document.getElementById("productSort").value;
  const products = state.products.filter((product) => {
    const haystack = [product.sku, product.name, product.supplier].join(" ").toLowerCase();
    return product.active !== false
      && (!q || haystack.includes(q))
      && (!category || product.category === category);
  });

  products.sort((a, b) => {
    if (sort === "cost-asc") return Number(a.costAvg || 0) - Number(b.costAvg || 0);
    if (sort === "cost-desc") return Number(b.costAvg || 0) - Number(a.costAvg || 0);
    if (sort === "stock-asc") return Number(a.stock || 0) - Number(b.stock || 0);
    if (sort === "stock-desc") return Number(b.stock || 0) - Number(a.stock || 0);
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  document.getElementById("productsTable").innerHTML = products.map((product) => {
    const low = Number(product.stock) <= Number(product.minStock);
    return `
      <tr>
        <td><strong>${product.name}</strong><br><span class="muted">${product.sku || "sem SKU"} | ${product.category}</span></td>
        <td>${product.supplier || "-"}</td>
        <td><span class="badge ${low ? "low" : "good"}">${product.stock}</span></td>
        <td>${formatMoney(product.costAvg)}</td>
        <td>
          <div class="inline-actions">
            <button class="sell-btn" type="button" data-sell="${product.id}" ${Number(product.stock) <= 0 ? "disabled" : ""}>Vender</button>
            <button type="button" data-edit="${product.id}">Editar</button>
            <button class="trash-btn icon-btn" type="button" data-delete="${product.id}" title="Apagar produto" aria-label="Apagar produto">Lixeira</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="5">Nenhum produto cadastrado.</td></tr>';

  document.querySelectorAll("[data-sell]").forEach((button) => {
    button.onclick = () => openQuickSale(button.dataset.sell);
  });
  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.onclick = () => editProduct(button.dataset.edit);
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.onclick = () => inactivateProduct(button.dataset.delete);
  });
}

function renderSupplierOptions() {
  const activeSuppliers = state.suppliers
    .filter((supplier) => supplier.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById("supplierOptions").innerHTML = activeSuppliers
    .map((supplier) => `<option value="${supplier.name}"></option>`)
    .join("");
}

function renderProductFormOptions() {
  const supplierSelect = document.getElementById("productSupplierSelect");
  const categorySelect = document.getElementById("productCategorySelect");
  if (supplierSelect) {
    const current = supplierSelect.value;
    const activeSuppliers = state.suppliers
      .filter((supplier) => supplier.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name));
    supplierSelect.innerHTML = [
      '<option value="">Selecione</option>',
      ...activeSuppliers.map((supplier) => `<option value="${supplier.name}">${supplier.name}</option>`)
    ].join("");
    supplierSelect.value = current;
  }
  if (categorySelect) {
    const current = categorySelect.value || "Produto";
    categorySelect.innerHTML = state.categories
      .map((category) => `<option value="${category}">${category}</option>`)
      .join("");
    categorySelect.value = state.categories.includes(current) ? current : "Produto";
  }
}

function renderProductFilters() {
  const categoryFilter = document.getElementById("categoryFilter");
  if (!categoryFilter) return;
  const current = categoryFilter.value;
  categoryFilter.innerHTML = [
    '<option value="">Todas categorias</option>',
    ...state.categories.map((category) => `<option value="${category}">${category}</option>`)
  ].join("");
  categoryFilter.value = state.categories.includes(current) ? current : "";
}

function renderSuppliers() {
  const search = document.getElementById("supplierSearch");
  if (!search) return;
  const q = search.value.toLowerCase().trim();
  const suppliers = state.suppliers.filter((supplier) => {
    const haystack = [
      supplier.name,
      supplier.market,
      supplier.kind,
      supplier.document,
      supplier.contact,
      supplier.email,
      supplier.phone,
      supplier.notes
    ].join(" ").toLowerCase();
    return supplier.active !== false && (!q || haystack.includes(q));
  });

  document.getElementById("suppliersList").innerHTML = suppliers.map((supplier) => `
    <div class="row-card">
      <strong>${supplier.name} <span class="badge">${supplier.score || 0}/100</span></strong>
      <span>${supplier.market || "-"} | ${supplier.kind || "-"} | ${supplier.document || "sem documento"}</span>
      <span>${supplier.contact || "sem contato"} ${supplier.email ? `| ${supplier.email}` : ""} ${supplier.phone ? `| ${supplier.phone}` : ""}</span>
      ${supplier.website ? `<span>${supplier.website}</span>` : ""}
      ${supplier.notes ? `<span>${supplier.notes}</span>` : ""}
      <div class="row-actions">
        <button type="button" data-edit-supplier="${supplier.id}">Editar</button>
        <button type="button" data-delete-supplier="${supplier.id}">Inativar</button>
      </div>
    </div>
  `).join("") || '<div class="row-card"><strong>Nenhum fornecedor cadastrado.</strong><span>Cadastre fornecedores para usar como sugestao em produtos e compras.</span></div>';

  document.querySelectorAll("[data-edit-supplier]").forEach((button) => {
    button.onclick = () => editSupplier(button.dataset.editSupplier);
  });
  document.querySelectorAll("[data-delete-supplier]").forEach((button) => {
    button.onclick = () => inactivateSupplier(button.dataset.deleteSupplier);
  });
}

function renderSpreadsheetPreview(result) {
  const target = document.getElementById("spreadsheetPreview");
  const applyButton = document.getElementById("applySpreadsheet");
  if (!target) return;

  if (!result) {
    target.innerHTML = "";
    applyButton.disabled = true;
    return;
  }

  const errors = [...(result.errors || [])];
  const warnings = result.warnings || [];
  const sample = (result.items || []).slice(0, 8);
  applyButton.disabled = errors.length > 0 || !sample.length;

  target.innerHTML = `
    <div class="preview-grid">
      <div class="preview-box"><span>Aba</span><strong>${result.sheetName || "-"}</strong></div>
      <div class="preview-box"><span>Produtos agrupados</span><strong>${result.itemCount || 0}</strong></div>
      <div class="preview-box"><span>Criar</span><strong>${result.createCount || 0}</strong></div>
      <div class="preview-box"><span>Atualizar</span><strong>${result.updateCount || 0}</strong></div>
    </div>
    ${warnings.map((warning) => `<div class="row-card"><strong>Aviso</strong><span>${warning}</span></div>`).join("")}
    ${errors.map((error) => `<div class="row-card"><strong>Erro</strong><span>${error}</span></div>`).join("")}
    ${sample.map((item) => `
      <div class="row-card">
        <strong>${item.action === "create" ? "Criar" : "Atualizar"} | ${item.name}</strong>
        <span>Estoque atual ${item.currentStock} -> planilha ${item.importedStock} -> final ${item.nextStock}</span>
        <span>Custo ${formatMoney(item.costAvg)} | Venda ${formatMoney(item.salePrice)} | linhas ${item.sourceRows.join(", ")}</span>
      </div>
    `).join("")}
  `;
}

function renderHistories() {
  document.getElementById("purchaseHistory").innerHTML = state.purchases.slice(0, 20).map((purchase) => `
    <div class="row-card">
      <strong>${purchase.supplier || "Fornecedor"} - ${formatMoney(purchase.total)}</strong>
      <span>${purchase.date} | NF ${purchase.invoice || "-"} | ${purchase.items.length} item(ns)</span>
    </div>
  `).join("") || '<div class="row-card"><strong>Nenhuma compra lancada.</strong></div>';

  document.getElementById("saleHistory").innerHTML = state.sales.slice(0, 20).map((sale) => `
    <div class="row-card">
      <strong>${sale.customer || "Cliente"} - ${formatMoney(sale.netRevenue)}</strong>
      <span>${sale.date} | ${sale.channel} | custo ${formatMoney(sale.costTotal)} | lucro ${formatMoney(sale.profit)} | margem ${sale.margin}%</span>
    </div>
  `).join("") || '<div class="row-card"><strong>Nenhuma venda lancada.</strong></div>';

  document.getElementById("movementHistory").innerHTML = state.movements.slice(0, 40).map((movement) => `
    <div class="row-card">
      <strong>${movement.type} | ${movement.productName}</strong>
      <span>${movement.date} | qtd ${movement.quantity} | custo ${formatMoney(movement.unitCost)} | ${movement.note || ""}</span>
    </div>
  `).join("") || '<div class="row-card"><strong>Nenhuma movimentacao.</strong></div>';
}

function refreshItemSelects() {
  document.querySelectorAll('.item-row select[name="productId"]').forEach((select) => {
    const current = select.value;
    select.innerHTML = productOptions(current);
  });
}

function editProduct(id) {
  const product = selectedProduct(id);
  if (!product) return;
  const form = document.getElementById("productForm");
  form.reset();
  renderProductFormOptions();
  for (const [key, value] of Object.entries(product)) {
    if (form.elements[key]) form.elements[key].value = value;
  }
  if (form.costAvg) form.costAvg.value = formatMoney(product.costAvg);
  document.getElementById("productModalTitle").textContent = "Editar produto";
  document.getElementById("productModal").classList.add("open");
  document.getElementById("productModal").setAttribute("aria-hidden", "false");
}

async function inactivateProduct(id) {
  if (!confirm("Apagar este produto da lista? O historico sera mantido.")) return;
  await api(`/api/products/${id}`, { method: "DELETE" });
  toast("Produto apagado da lista.");
  await loadAll();
}

function openProductModal() {
  const form = document.getElementById("productForm");
  form.reset();
  renderProductFormOptions();
  form.id.value = "";
  if (form.category) form.category.value = "Produto";
  document.getElementById("productModalTitle").textContent = "Novo produto";
  document.getElementById("productModal").classList.add("open");
  document.getElementById("productModal").setAttribute("aria-hidden", "false");
  form.name.focus();
}

function closeProductModal() {
  const modal = document.getElementById("productModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function addCategoryFromProductModal() {
  const name = prompt("Nome da nova categoria:");
  if (!name || !name.trim()) return;
  try {
    const result = await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() })
    });
    if (!state.categories.includes(result.name)) {
      state.categories.push(result.name);
      state.categories.sort((a, b) => a.localeCompare(b));
    }
    renderProductFormOptions();
    renderProductFilters();
    document.getElementById("productCategorySelect").value = result.name;
    toast("Categoria cadastrada.");
  } catch (error) {
    toast(error.message);
  }
}

function editSupplier(id) {
  const supplier = state.suppliers.find((item) => item.id === id);
  if (!supplier) return;
  const form = document.getElementById("supplierForm");
  form.reset();
  for (const [key, value] of Object.entries(supplier)) {
    if (form.elements[key]) form.elements[key].value = value;
  }
  document.getElementById("supplierModalTitle").textContent = "Editar fornecedor";
  document.getElementById("supplierModal").classList.add("open");
  document.getElementById("supplierModal").setAttribute("aria-hidden", "false");
}

function openSupplierModal() {
  const form = document.getElementById("supplierForm");
  form.reset();
  form.id.value = "";
  form.score.value = 0;
  document.getElementById("supplierModalTitle").textContent = "Novo fornecedor";
  document.getElementById("supplierModal").classList.add("open");
  document.getElementById("supplierModal").setAttribute("aria-hidden", "false");
  form.name.focus();
}

function closeSupplierModal() {
  const modal = document.getElementById("supplierModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function inactivateSupplier(id) {
  if (!confirm("Inativar este fornecedor? Produtos e historico continuam mantidos.")) return;
  await api(`/api/suppliers/${id}`, { method: "DELETE" });
  toast("Fornecedor inativado.");
  await loadAll();
}

function openQuickSale(id) {
  const product = selectedProduct(id);
  if (!product) return;
  const modal = document.getElementById("quickSaleModal");
  const form = document.getElementById("quickSaleForm");
  form.reset();
  form.productId.value = product.id;
  form.date.value = today();
  form.quantity.max = product.stock;
  form.quantity.value = Number(product.stock) > 0 ? 1 : 0;
  form.unitPrice.value = Number(product.salePrice || 0);
  form.fees.value = 0;
  form.discount.value = 0;
  document.getElementById("quickSaleProductInfo").textContent =
    `${product.name} | estoque ${product.stock} | custo ${formatMoney(product.costAvg)}`;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  calculateQuickSale();
  form.unitPrice.focus();
}

function closeQuickSale() {
  const modal = document.getElementById("quickSaleModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function calculateQuickSale() {
  const form = document.getElementById("quickSaleForm");
  const product = selectedProduct(form.productId.value);
  if (!product) return;
  const quantity = Number(form.quantity.value || 0);
  const unitPrice = Number(form.unitPrice.value || 0);
  const fees = Number(form.fees.value || 0);
  const discount = Number(form.discount.value || 0);
  const gross = quantity * unitPrice;
  const net = gross - discount;
  const cost = quantity * Number(product.costAvg || 0);
  const profit = net - cost - fees;
  const margin = net > 0 ? Math.round((profit / net) * 10000) / 100 : 0;
  document.getElementById("quickSaleTotal").textContent = formatMoney(net);
  document.getElementById("quickSaleProfit").textContent = formatMoney(profit);
  document.getElementById("quickSaleMargin").textContent = `${margin}%`;
}

function bindQuickSale() {
  const form = document.getElementById("quickSaleForm");
  document.querySelectorAll("[data-close-sale]").forEach((button) => {
    button.onclick = closeQuickSale;
  });
  form.oninput = calculateQuickSale;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const product = selectedProduct(form.productId.value);
    if (!product) return;
    const quantity = Number(form.quantity.value || 0);
    if (quantity <= 0) {
      toast("Informe uma quantidade valida.");
      return;
    }
    if (quantity > Number(product.stock || 0)) {
      toast("Quantidade maior que o estoque disponivel.");
      return;
    }

    const payload = {
      date: form.date.value || today(),
      customer: form.customer.value,
      channel: form.channel.value,
      paymentMethod: form.paymentMethod.value,
      paymentStatus: "Pago",
      discount: Number(form.discount.value || 0),
      shippingCharged: 0,
      fees: Number(form.fees.value || 0),
      notes: form.notes.value,
      items: [{
        productId: product.id,
        quantity,
        unitPrice: Number(form.unitPrice.value || 0)
      }]
    };

    try {
      await api("/api/sales", { method: "POST", body: JSON.stringify(payload) });
      closeQuickSale();
      toast("Venda lancada e estoque atualizado.");
      await loadAll();
    } catch (error) {
      toast(error.message);
    }
  };
}

function calculatePurchaseTotal() {
  const form = document.getElementById("purchaseForm");
  const items = collectItems(document.getElementById("purchaseItems"), "unitCost");
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const extra = Number(form.extraCosts.value || 0);
  document.getElementById("purchaseTotal").textContent = formatMoney(subtotal + extra);
}

function calculateSaleTotal() {
  const form = document.getElementById("saleForm");
  const items = collectItems(document.getElementById("saleItems"), "unitPrice");
  const gross = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const cost = items.reduce((sum, item) => {
    const product = selectedProduct(item.productId);
    return sum + item.quantity * Number(product?.costAvg || 0);
  }, 0);
  const discount = Number(form.discount.value || 0);
  const shipping = Number(form.shippingCharged.value || 0);
  const fees = Number(form.fees.value || 0);
  const net = gross - discount + shipping;
  const profit = net - cost - fees;
  document.getElementById("saleTotal").textContent = formatMoney(net);
  document.getElementById("saleProfit").textContent = formatMoney(profit);
}

function setDefaultDates() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = today();
  });
}

function bindTabs() {
  const titles = {
    dashboard: ["Dashboard", "Controle local para produtos variados."],
    products: ["Produtos", "Cadastre SKUs, fornecedor, custo medio, preco de venda e estoque minimo."],
    suppliers: ["Fornecedores", "Cadastre contatos, score e dados comerciais dos seus fornecedores."],
    purchase: ["Compras", "Lance compras e atualize estoque/custo medio automaticamente."],
    sale: ["Venda", "Baixe estoque e calcule faturamento, taxas e lucro."],
    history: ["Historico", "Veja compras, vendas e movimentacoes de estoque."]
  };
  document.querySelectorAll(".nav").forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll(".nav").forEach((nav) => nav.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("visible"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("visible");
      document.getElementById("pageTitle").textContent = titles[button.dataset.tab][0];
      document.getElementById("pageSubtitle").textContent = titles[button.dataset.tab][1];
    };
  });
}

function bindForms() {
  const productForm = document.getElementById("productForm");
  document.getElementById("openProductModal").onclick = openProductModal;
  document.getElementById("addCategoryBtn").onclick = addCategoryFromProductModal;
  document.querySelectorAll(".money-input").forEach((input) => {
    input.onblur = () => {
      input.value = input.value ? formatMoney(parseMoneyInput(input.value)) : "";
    };
    input.onfocus = () => input.select();
  });
  document.querySelectorAll("[data-close-product]").forEach((button) => {
    button.onclick = closeProductModal;
  });
  productForm.onsubmit = async (event) => {
    event.preventDefault();
    const payload = getFormData(productForm);
    payload.costAvg = parseMoneyInput(payload.costAvg);
    await api(payload.id ? `/api/products/${payload.id}` : "/api/products", {
      method: payload.id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    productForm.reset();
    closeProductModal();
    toast("Produto salvo.");
    await loadAll();
  };

  document.getElementById("productSearch").oninput = renderProducts;
  document.getElementById("categoryFilter").onchange = renderProducts;
  document.getElementById("productSort").onchange = renderProducts;
  bindSpreadsheetImport();

  const supplierForm = document.getElementById("supplierForm");
  document.getElementById("openSupplierModal").onclick = openSupplierModal;
  document.querySelectorAll("[data-close-supplier]").forEach((button) => {
    button.onclick = closeSupplierModal;
  });
  supplierForm.onsubmit = async (event) => {
    event.preventDefault();
    const payload = getFormData(supplierForm);
    await api(payload.id ? `/api/suppliers/${payload.id}` : "/api/suppliers", {
      method: payload.id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    supplierForm.reset();
    supplierForm.score.value = 0;
    closeSupplierModal();
    toast("Fornecedor salvo.");
    await loadAll();
  };

  document.getElementById("supplierSearch").oninput = renderSuppliers;

  const purchaseItems = document.getElementById("purchaseItems");
  document.getElementById("addPurchaseItem").onclick = () => {
    purchaseItems.insertAdjacentHTML("beforeend", itemRow("purchase"));
    setupItemEvents(purchaseItems, calculatePurchaseTotal, "purchase");
  };
  document.getElementById("purchaseForm").oninput = calculatePurchaseTotal;
  document.getElementById("purchaseForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      ...getFormData(form),
      items: collectItems(purchaseItems, "unitCost")
    };
    await api("/api/purchases", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    purchaseItems.innerHTML = "";
    setDefaultDates();
    addInitialRows();
    toast("Compra lancada.");
    await loadAll();
  };

  const saleItems = document.getElementById("saleItems");
  document.getElementById("addSaleItem").onclick = () => {
    saleItems.insertAdjacentHTML("beforeend", itemRow("sale"));
    setupItemEvents(saleItems, calculateSaleTotal, "sale");
  };
  document.getElementById("saleForm").oninput = calculateSaleTotal;
  document.getElementById("saleForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      ...getFormData(form),
      items: collectItems(saleItems, "unitPrice")
    };
    await api("/api/sales", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    saleItems.innerHTML = "";
    setDefaultDates();
    addInitialRows();
    toast("Venda lancada.");
    await loadAll();
  };
}

function bindSpreadsheetImport() {
  const modal = document.getElementById("spreadsheetModal");
  const openButton = document.getElementById("openImportSpreadsheet");
  const fileInput = document.getElementById("spreadsheetFile");
  const replaceInput = document.getElementById("replaceStock");
  const previewButton = document.getElementById("previewSpreadsheet");
  const applyButton = document.getElementById("applySpreadsheet");
  if (!fileInput || previewButton.dataset.bound) return;
  previewButton.dataset.bound = "true";

  openButton.onclick = () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
  document.querySelectorAll("[data-close-import]").forEach((button) => {
    button.onclick = () => {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    };
  });

  async function buildPayload(apply = false) {
    const file = fileInput.files[0];
    if (!file) throw new Error("Selecione uma planilha .xlsx ou .csv.");
    return {
      fileName: file.name,
      contentBase64: await fileToBase64(file),
      replaceStock: replaceInput.checked,
      apply
    };
  }

  previewButton.onclick = async () => {
    try {
      applyButton.disabled = true;
      const result = await api("/api/products-import", {
        method: "POST",
        body: JSON.stringify(await buildPayload(false))
      });
      state.spreadsheetImport = result;
      renderSpreadsheetPreview(result);
      toast("Previa gerada.");
    } catch (error) {
      state.spreadsheetImport = null;
      renderSpreadsheetPreview({ errors: [error.message], warnings: [], items: [] });
      toast(error.message);
    }
  };

  applyButton.onclick = async () => {
    if (!state.spreadsheetImport) return;
    if (!confirm("Confirmar importacao da planilha no estoque?")) return;
    try {
      const result = await api("/api/products-import", {
        method: "POST",
        body: JSON.stringify(await buildPayload(true))
      });
      state.spreadsheetImport = null;
      fileInput.value = "";
      renderSpreadsheetPreview(null);
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      toast(`Importacao concluida: ${result.itemCount} produto(s).`);
      await loadAll();
    } catch (error) {
      toast(error.message);
    }
  };

  fileInput.onchange = () => {
    state.spreadsheetImport = null;
    renderSpreadsheetPreview(null);
  };
  replaceInput.onchange = () => {
    state.spreadsheetImport = null;
    renderSpreadsheetPreview(null);
  };
}

function bindBackup() {
  const exportBtn = document.getElementById("exportBtn");
  const importFile = document.getElementById("importFile");
  if (!exportBtn || !importFile) return;

  exportBtn.onclick = async () => {
    const data = await api("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `loja-erp-backup-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  importFile.onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm("Importar backup vai substituir os dados locais atuais. Continuar?")) return;
    const text = await file.text();
    await api("/api/import", { method: "POST", body: text });
    toast("Backup importado.");
    await loadAll();
  };
}

function addInitialRows() {
  if (!document.querySelector("#purchaseItems .item-row")) {
    document.getElementById("purchaseItems").insertAdjacentHTML("beforeend", itemRow("purchase"));
    setupItemEvents(document.getElementById("purchaseItems"), calculatePurchaseTotal, "purchase");
  }
  if (!document.querySelector("#saleItems .item-row")) {
    document.getElementById("saleItems").insertAdjacentHTML("beforeend", itemRow("sale"));
    setupItemEvents(document.getElementById("saleItems"), calculateSaleTotal, "sale");
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindForms();
  bindQuickSale();
  bindBackup();
  setDefaultDates();
  addInitialRows();
  try {
    await loadAll();
  } catch (error) {
    toast(error.message);
  }
});
