const state = {
  products: [],
  categories: [],
  activeCategory: "Todos",
  query: "",
  sort: "featured",
  detailProductId: productIdFromPath(),
  customer: loadCustomer(),
  cart: loadCart()
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatMoney(value) {
  return money.format(Number(value || 0));
}

function productIdFromPath() {
  const match = window.location.pathname.match(/^\/produto\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function productDescription(product) {
  const description = String(product.description || "").trim();
  if (description) return description;
  return [
    `${product.name} disponivel para pronta venda.`,
    product.category ? `Categoria: ${product.category}.` : ""
  ].filter(Boolean).join(" ");
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("scaff-store-cart") || "{}");
  } catch {
    return {};
  }
}

function saveCart() {
  localStorage.setItem("scaff-store-cart", JSON.stringify(state.cart));
}

function loadCustomer() {
  try {
    return JSON.parse(localStorage.getItem("scaff-store-customer") || "null");
  } catch {
    return null;
  }
}

function saveCustomer(customer) {
  state.customer = customer;
  if (customer) {
    localStorage.setItem("scaff-store-customer", JSON.stringify(customer));
  } else {
    localStorage.removeItem("scaff-store-customer");
  }
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

function productById(id) {
  return state.products.find((product) => product.id === id);
}

function cartEntries() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({ product: productById(id), quantity }))
    .filter((item) => item.product && item.quantity > 0);
}

function cartCount() {
  return cartEntries().reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotal() {
  return cartEntries().reduce((sum, item) => sum + item.quantity * Number(item.product.salePrice || 0), 0);
}

function openCart() {
  document.getElementById("cartDrawer").classList.add("open");
  document.getElementById("cartDrawer").setAttribute("aria-hidden", "false");
  document.getElementById("drawerBackdrop").classList.add("open");
}

function closeCart() {
  document.getElementById("cartDrawer").classList.remove("open");
  document.getElementById("cartDrawer").setAttribute("aria-hidden", "true");
  document.getElementById("drawerBackdrop").classList.remove("open");
}

function openAuthModal(id) {
  closeProfileMenu();
  document.querySelectorAll(".auth-modal").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
  const modal = document.getElementById(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeAuthModals() {
  document.querySelectorAll(".auth-modal").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
}

function openLogin() {
  openAuthModal("loginModal");
}

function openRegister() {
  openAuthModal("registerModal");
}

function toggleProfileMenu() {
  if (!state.customer) {
    openLogin();
    return;
  }
  const menu = document.getElementById("profileMenu");
  menu.hidden = !menu.hidden;
}

function closeProfileMenu() {
  const menu = document.getElementById("profileMenu");
  if (menu) menu.hidden = true;
}

function openProductDetail(id, push = true) {
  const product = productById(id);
  if (!product) return;
  state.detailProductId = id;
  if (push) window.history.pushState({ productId: id }, "", `/produto/${encodeURIComponent(id)}`);
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeProductDetail(push = true) {
  state.detailProductId = "";
  if (push) window.history.pushState({}, "", "/");
  renderAll();
}

function productImage(product, className = "") {
  if (product.imageDataUrl) {
    return `<img class="${className}" src="${product.imageDataUrl}" alt="">`;
  }
  return `<span class="${className}">Sem foto</span>`;
}

function filteredProducts() {
  const query = state.query.toLowerCase().trim();
  const products = state.products.filter((product) => {
    const matchesCategory = state.activeCategory === "Todos" || product.category === state.activeCategory;
    const haystack = [product.name, product.category].join(" ").toLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });

  return products.sort((a, b) => {
    if (state.sort === "price-asc") return Number(a.salePrice || 0) - Number(b.salePrice || 0);
    if (state.sort === "price-desc") return Number(b.salePrice || 0) - Number(a.salePrice || 0);
    if (state.sort === "name-asc") return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
    return 0;
  });
}

function renderCategories() {
  const target = document.getElementById("categoryFilters");
  const categories = ["Todos", ...state.categories];
  target.innerHTML = categories.map((category) => `
    <button class="${category === state.activeCategory ? "active" : ""}" type="button" data-category="${category}">
      ${category}
    </button>
  `).join("");

  target.querySelectorAll("[data-category]").forEach((button) => {
    button.onclick = () => {
      state.activeCategory = button.dataset.category;
      renderAll();
    };
  });
}

function renderProducts() {
  const isDetailOpen = Boolean(state.detailProductId);
  document.querySelector(".hero").hidden = isDetailOpen;
  document.querySelector(".toolbar").hidden = isDetailOpen;
  document.getElementById("statusMessage").hidden = isDetailOpen;
  document.getElementById("productGrid").hidden = isDetailOpen;
  document.getElementById("productDetail").hidden = !isDetailOpen;
  if (isDetailOpen) {
    renderProductDetail();
    return;
  }

  const products = filteredProducts();
  const target = document.getElementById("productGrid");
  document.getElementById("statusMessage").textContent = products.length
    ? `${products.length} produto(s) encontrado(s).`
    : "Nenhum produto encontrado com estes filtros.";

  target.innerHTML = products.map((product) => `
    <a class="product-card" href="/produto/${encodeURIComponent(product.id)}" data-open-product="${product.id}">
      <span class="product-open">
        <span class="product-media">${productImage(product)}</span>
      </span>
      <span class="product-info">
        <h2>${product.name}</h2>
        <span class="product-price">
          <strong>${formatMoney(product.salePrice)}</strong>
        </span>
      </span>
    </a>
  `).join("");

}

function renderProductDetail() {
  const product = productById(state.detailProductId);
  const target = document.getElementById("productDetail");
  if (!product) {
    target.innerHTML = `
      <button class="back-button" type="button" data-back-store>Voltar para a loja</button>
      <div class="detail-empty">Produto nao encontrado ou indisponivel.</div>
    `;
    target.querySelector("[data-back-store]").onclick = () => closeProductDetail();
    return;
  }

  const recommendations = state.products
    .filter((candidate) => candidate.id !== product.id && candidate.category === product.category)
    .slice(0, 4);
  const fallbackRecommendations = state.products
    .filter((candidate) => candidate.id !== product.id)
    .slice(0, 4);
  const recommendedProducts = recommendations.length ? recommendations : fallbackRecommendations;

  target.innerHTML = `
    <button class="back-button" type="button" data-back-store>Voltar para a loja</button>
    <article class="detail-layout">
      <section class="detail-gallery">
        <div class="detail-main-image">${productImage(product)}</div>
        <div class="detail-thumbs">
          <button class="thumb active" type="button">${productImage(product)}</button>
          <button class="thumb" type="button"><span>${product.category}</span></button>
        </div>
      </section>
      <section class="detail-info">
        <div class="detail-meta">${product.category}</div>
        <h1>${product.name}</h1>
        <p class="detail-description">${productDescription(product)}</p>
        <div class="detail-buy-box">
          <span class="stock-pill">Disponivel para compra</span>
          <strong>${formatMoney(product.salePrice)}</strong>
          <div class="detail-actions">
            <button class="buy-now" type="button" data-buy-now="${product.id}">Comprar agora</button>
            <button type="button" data-add="${product.id}">Colocar no carrinho</button>
          </div>
        </div>
      </section>
    </article>
    <section class="recommendations">
      <div class="section-title">
        <h2>Recomendacoes</h2>
        <span>${product.category}</span>
      </div>
      <div class="recommendation-grid">
        ${recommendedProducts.map((item) => `
          <article class="recommendation-card">
            <a href="/produto/${encodeURIComponent(item.id)}">
              <span class="recommendation-media">${productImage(item)}</span>
              <strong>${item.name}</strong>
              <span>${formatMoney(item.salePrice)}</span>
            </a>
          </article>
        `).join("") || '<div class="status-message">Cadastre mais produtos para gerar recomendacoes.</div>'}
      </div>
    </section>
  `;

  target.querySelector("[data-back-store]").onclick = () => closeProductDetail();
  target.querySelectorAll("[data-add]").forEach((button) => {
    button.onclick = () => addToCart(button.dataset.add);
  });
  target.querySelectorAll("[data-buy-now]").forEach((button) => {
    button.onclick = () => {
      addToCart(button.dataset.buyNow);
      openCart();
    };
  });
}

function renderCart() {
  const entries = cartEntries();
  const count = cartCount();
  document.getElementById("cartCount").textContent = count;
  document.getElementById("cartSubtitle").textContent = count ? `${count} item(ns)` : "Nenhum item";
  document.getElementById("cartTotal").textContent = formatMoney(cartTotal());

  document.getElementById("cartItems").innerHTML = entries.map(({ product, quantity }) => `
    <div class="cart-item">
      ${product.imageDataUrl ? `<img class="cart-thumb" src="${product.imageDataUrl}" alt="">` : `<div class="cart-thumb"></div>`}
      <div>
        <strong>${product.name}</strong>
        <span>${formatMoney(product.salePrice)} un.</span>
        <div class="qty-row">
          <div class="qty-controls">
            <button class="qty-button" type="button" data-dec="${product.id}">-</button>
            <strong>${quantity}</strong>
            <button class="qty-button" type="button" data-inc="${product.id}">+</button>
          </div>
          <button class="qty-button" type="button" data-remove="${product.id}">Remover</button>
        </div>
      </div>
    </div>
  `).join("") || '<div class="status-message">Seu carrinho esta vazio.</div>';

  document.querySelectorAll("[data-inc]").forEach((button) => {
    button.onclick = () => addToCart(button.dataset.inc);
  });
  document.querySelectorAll("[data-dec]").forEach((button) => {
    button.onclick = () => changeQuantity(button.dataset.dec, -1);
  });
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.onclick = () => removeFromCart(button.dataset.remove);
  });

  const checkoutForm = document.getElementById("checkoutForm");
  if (state.customer && checkoutForm) {
    checkoutForm.customerName.value = state.customer.name || checkoutForm.customerName.value;
    checkoutForm.customerEmail.value = state.customer.email || checkoutForm.customerEmail.value;
    checkoutForm.customerPhone.value = state.customer.phone || checkoutForm.customerPhone.value;
  }
}

function renderAll() {
  renderCategories();
  renderProducts();
  renderCart();
  renderProfile();
}

function renderProfile() {
  const customer = state.customer;
  document.getElementById("profileLabel").textContent = customer ? "Perfil" : "Entrar";
  if (!customer) closeProfileMenu();
}

function showAccountSection(section) {
  if (!state.customer) {
    openLogin();
    return;
  }
  closeProfileMenu();
  const title = document.getElementById("accountTitle");
  const subtitle = document.getElementById("accountSubtitle");
  const content = document.getElementById("accountContent");
  const customer = state.customer;
  const address = [customer.street, customer.number, customer.neighborhood, customer.city, customer.state, customer.zipCode]
    .filter(Boolean).join(" | ");

  if (section === "orders") {
    title.textContent = "Meus pedidos";
    subtitle.textContent = "Pedidos feitos neste site";
    content.innerHTML = '<div class="account-empty">Seus pedidos finalizados aparecem aqui nas proximas etapas da loja.</div>';
  } else if (section === "wallet") {
    title.textContent = "Minha carteira";
    subtitle.textContent = "Pagamentos e saldos";
    content.innerHTML = '<div class="account-empty">Carteira, cupons e formas de pagamento serao conectados aqui.</div>';
  } else {
    title.textContent = "Meu perfil";
    subtitle.textContent = customer.name || "Cliente";
    content.innerHTML = `
      <div class="account-row"><span>Nome</span><strong>${customer.name || "-"}</strong></div>
      <div class="account-row"><span>E-mail</span><strong>${customer.email || "-"}</strong></div>
      <div class="account-row"><span>Celular</span><strong>${customer.phone || "-"}</strong></div>
      <div class="account-row"><span>Endereco</span><strong>${address || "-"}</strong></div>
    `;
  }
  openAuthModal("accountModal");
}

function addToCart(id) {
  const product = productById(id);
  if (!product) return;
  const current = Number(state.cart[id] || 0);
  if (current >= Number(product.stock || 0)) {
    toast("Quantidade maxima disponivel para este produto.");
    return;
  }
  state.cart[id] = current + 1;
  saveCart();
  renderCart();
  toast("Produto adicionado ao carrinho.");
}

function changeQuantity(id, delta) {
  const product = productById(id);
  if (!product) return;
  const next = Number(state.cart[id] || 0) + delta;
  if (next <= 0) {
    delete state.cart[id];
  } else if (next <= Number(product.stock || 0)) {
    state.cart[id] = next;
  } else {
    toast("Quantidade maxima disponivel para este produto.");
  }
  saveCart();
  renderCart();
}

function removeFromCart(id) {
  delete state.cart[id];
  saveCart();
  renderCart();
}

function bindEvents() {
  document.getElementById("profileToggle").onclick = toggleProfileMenu;
  document.getElementById("cartToggle").onclick = openCart;
  document.getElementById("cartClose").onclick = closeCart;
  document.getElementById("drawerBackdrop").onclick = () => {
    closeCart();
  };
  document.querySelectorAll("[data-close-auth]").forEach((button) => {
    button.onclick = closeAuthModals;
  });
  document.getElementById("openRegister").onclick = openRegister;
  document.querySelectorAll("[data-profile-action]").forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.profileAction;
      if (action === "logout") {
        saveCustomer(null);
        closeProfileMenu();
        renderAll();
        toast("Voce saiu do perfil.");
      } else {
        showAccountSection(action);
      }
    };
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".profile-menu-wrap")) closeProfileMenu();
  });
  document.getElementById("searchInput").oninput = (event) => {
    state.query = event.target.value;
    renderProducts();
  };
  document.getElementById("sortSelect").onchange = (event) => {
    state.sort = event.target.value;
    renderProducts();
  };
  window.onpopstate = () => {
    state.detailProductId = productIdFromPath();
    renderAll();
  };

  document.getElementById("registerZipCode").onblur = fillAddressFromCep;
  document.getElementById("loginForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const customer = await api("/api/storefront/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      saveCustomer(customer);
      form.reset();
      renderProfile();
      closeAuthModals();
      toast("Login realizado.");
    } catch (error) {
      toast(error.message);
    }
  };
  document.getElementById("registerForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const customer = await api("/api/storefront/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      saveCustomer(customer);
      form.reset();
      renderProfile();
      closeAuthModals();
      toast("Cadastro realizado.");
    } catch (error) {
      toast(error.message);
    }
  };

  document.getElementById("checkoutForm").onsubmit = async (event) => {
    event.preventDefault();
    const entries = cartEntries();
    if (!entries.length) {
      toast("Adicione produtos ao carrinho.");
      return;
    }
    if (!state.customer) {
      toast("Entre no perfil para finalizar a compra.");
      openLogin();
      return;
    }

    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.customerName = state.customer.name || payload.customerName;
    payload.customerEmail = state.customer.email || payload.customerEmail;
    payload.customerPhone = state.customer.phone || payload.customerPhone;
    payload.customerId = state.customer.id;
    payload.items = entries.map(({ product, quantity }) => ({
      productId: product.id,
      quantity
    }));

    try {
      const result = await api("/api/storefront/checkout", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.cart = {};
      saveCart();
      form.reset();
      await loadStorefront();
      closeCart();
      toast(`Pedido ${result.orderId} criado. Total ${formatMoney(result.total)}.`);
    } catch (error) {
      toast(error.message);
    }
  };
}

async function fillAddressFromCep(event) {
  const cep = String(event.currentTarget.value || "").replace(/\D/g, "");
  if (cep.length !== 8) return;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await response.json();
    if (!response.ok || data.erro) throw new Error("CEP nao encontrado.");

    const form = document.getElementById("registerForm");
    form.street.value = data.logradouro || form.street.value;
    form.neighborhood.value = data.bairro || form.neighborhood.value;
    form.city.value = data.localidade || form.city.value;
    form.state.value = data.uf || form.state.value;
  } catch (error) {
    toast(error.message);
  }
}

async function loadStorefront() {
  const data = await api("/api/storefront");
  state.products = data.products || [];
  state.categories = data.categories || [];
  document.getElementById("storeName").textContent = data.storeName || "Scaff TCG";
  document.getElementById("heroProductCount").textContent = `${state.products.length} produto(s)`;

  for (const id of Object.keys(state.cart)) {
    const product = productById(id);
    if (!product) {
      delete state.cart[id];
    } else if (state.cart[id] > product.stock) {
      state.cart[id] = product.stock;
    }
  }
  saveCart();
  renderAll();
}

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  try {
    await loadStorefront();
  } catch (error) {
    document.getElementById("statusMessage").textContent = error.message;
  }
});
