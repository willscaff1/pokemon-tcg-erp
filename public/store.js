const state = {
  products: [],
  categories: [],
  activeCategory: "Todos",
  query: "",
  sort: "featured",
  detailProductId: productIdFromPath(),
  accountPage: accountPageFromPath(),
  customer: loadCustomer(),
  cards: loadCards(),
  checkoutStep: "summary",
  lastOrder: null,
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

function accountPageFromPath() {
  const match = window.location.pathname.match(/^\/(perfil|pedidos|carteira)$/);
  return match ? match[1] : "";
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

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem("scaff-store-cards") || "[]");
  } catch {
    return [];
  }
}

function saveCards(cards) {
  state.cards = cards;
  localStorage.setItem("scaff-store-cards", JSON.stringify(cards));
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

function customerAddress(customer = state.customer || {}) {
  return [customer.street, customer.number, customer.complement, customer.neighborhood, customer.city, customer.state, customer.zipCode]
    .filter(Boolean).join(" | ");
}

function hasDeliveryAddress(customer = state.customer) {
  return Boolean(customer && customer.street && customer.number && customer.neighborhood && customer.city && customer.state && customer.zipCode);
}

function openCart() {
  if (!cartEntries().length) state.checkoutStep = "summary";
  document.getElementById("cartDrawer").classList.add("open");
  document.getElementById("cartDrawer").setAttribute("aria-hidden", "false");
  document.getElementById("drawerBackdrop").classList.add("open");
  renderCart();
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

function openEditProfile() {
  if (!state.customer) return openLogin();
  const form = document.getElementById("editProfileForm");
  form.reset();
  for (const [key, value] of Object.entries(state.customer)) {
    if (form.elements[key]) form.elements[key].value = value || "";
  }
  form.lgpdAccepted.checked = false;
  openAuthModal("editProfileModal");
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
  state.accountPage = "";
  if (push) window.history.pushState({ productId: id }, "", `/produto/${encodeURIComponent(id)}`);
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeProductDetail(push = true) {
  state.detailProductId = "";
  state.accountPage = "";
  if (push) window.history.pushState({}, "", "/");
  renderAll();
}

function navigateAccountPage(page, push = true) {
  state.detailProductId = "";
  state.accountPage = page;
  closeProfileMenu();
  if (push) window.history.pushState({ accountPage: page }, "", `/${page}`);
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  const target = document.getElementById("categorySelect");
  const categories = ["Todos", ...state.categories];
  target.innerHTML = categories.map((category) => `
    <option value="${category}" ${category === state.activeCategory ? "selected" : ""}>${category}</option>
  `).join("");
}

function renderProducts() {
  const isDetailOpen = Boolean(state.detailProductId);
  const isAccountOpen = Boolean(state.accountPage);
  document.querySelector(".hero").hidden = isDetailOpen || isAccountOpen;
  document.querySelector(".toolbar").hidden = isDetailOpen || isAccountOpen;
  document.getElementById("statusMessage").hidden = isDetailOpen || isAccountOpen;
  document.getElementById("productGrid").hidden = isDetailOpen || isAccountOpen;
  document.getElementById("productDetail").hidden = !isDetailOpen;
  document.getElementById("accountPage").hidden = !isAccountOpen;
  if (isAccountOpen) {
    renderAccountPage();
    return;
  }
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

  renderCheckoutPanel();
}

function renderCheckoutPanel() {
  const panel = document.getElementById("checkoutPanel");
  const entries = cartEntries();
  const steps = ["summary", "delivery", "payment", "done"];
  document.querySelectorAll("[data-step-indicator]").forEach((indicator) => {
    const step = indicator.dataset.stepIndicator;
    indicator.classList.toggle("active", step === state.checkoutStep);
    indicator.classList.toggle("done", steps.indexOf(step) < steps.indexOf(state.checkoutStep));
  });

  if (!entries.length && state.checkoutStep !== "done") {
    panel.innerHTML = '<div class="status-message">Adicione produtos para iniciar o pedido.</div>';
    return;
  }

  if (state.checkoutStep === "summary") {
    panel.innerHTML = `
      <button class="checkout-button" type="button" data-next-checkout>Continuar para entrega</button>
      <p class="checkout-note">Revise os itens antes de seguir.</p>
    `;
  } else if (state.checkoutStep === "delivery") {
    const customer = state.customer;
    if (!customer) {
      panel.innerHTML = `
        <div class="status-message">Entre no perfil para continuar.</div>
        <button class="checkout-button" type="button" data-open-login>Entrar</button>
      `;
    } else {
      panel.innerHTML = `
        <div class="checkout-section">
          <strong>Entrega</strong>
          <span>${customer.name || "Cliente"} | ${customer.phone || "sem telefone"}</span>
          <span>CPF: ${customer.cpf || "nao informado"}</span>
          <span>${customerAddress(customer) || "Endereco nao cadastrado"}</span>
        </div>
        <div class="checkout-actions">
          <button class="secondary-button" type="button" data-prev-checkout>Voltar</button>
          <button class="secondary-button" type="button" data-edit-profile>Editar endereco</button>
          <button class="checkout-button" type="button" data-next-checkout ${hasDeliveryAddress(customer) ? "" : "disabled"}>Continuar para pagamento</button>
        </div>
        ${hasDeliveryAddress(customer) ? "" : '<p class="checkout-note">Complete o endereco do perfil para envio pelos Correios.</p>'}
      `;
    }
  } else if (state.checkoutStep === "payment") {
    panel.innerHTML = `
      <div class="payment-options compact" role="radiogroup" aria-label="Forma de pagamento do pedido">
        <label class="payment-option active">
          <input name="checkoutPayment" type="radio" value="PIX" checked>
          <span><strong>PIX</strong><small>Aprovacao imediata simulada</small></span>
        </label>
        <label class="payment-option">
          <input name="checkoutPayment" type="radio" value="Cartao">
          <span><strong>Cartao</strong><small>Credito cadastrado</small></span>
        </label>
      </div>
      <label>Observacoes
        <textarea name="notes" rows="3" placeholder="Comentario sobre entrega ou pedido"></textarea>
      </label>
      <div class="checkout-actions">
        <button class="secondary-button" type="button" data-prev-checkout>Voltar</button>
        <button class="checkout-button" type="submit">Pagar e confirmar pedido</button>
      </div>
    `;
  } else {
    panel.innerHTML = `
      <div class="checkout-confirmed">
        <strong>Pedido confirmado</strong>
        <span>${state.lastOrder ? `Pedido ${state.lastOrder.orderId} aprovado em ${state.lastOrder.paymentMethod}.` : "Pagamento aprovado."}</span>
      </div>
      <button class="checkout-button" type="button" data-close-cart>Fechar</button>
    `;
  }

  panel.querySelectorAll("[data-next-checkout]").forEach((button) => {
    button.onclick = () => nextCheckoutStep();
  });
  panel.querySelectorAll("[data-prev-checkout]").forEach((button) => {
    button.onclick = () => prevCheckoutStep();
  });
  panel.querySelectorAll("[data-open-login]").forEach((button) => {
    button.onclick = openLogin;
  });
  panel.querySelectorAll("[data-edit-profile]").forEach((button) => {
    button.onclick = openEditProfile;
  });
  panel.querySelectorAll("[data-close-cart]").forEach((button) => {
    button.onclick = closeCart;
  });
  panel.querySelectorAll('.payment-option input[name="checkoutPayment"]').forEach((input) => {
    input.onchange = () => {
      panel.querySelectorAll(".payment-option").forEach((option) => option.classList.remove("active"));
      input.closest(".payment-option").classList.add("active");
    };
  });
}

function nextCheckoutStep() {
  if (state.checkoutStep === "summary") {
    if (!state.customer) {
      toast("Entre no perfil para continuar.");
      openLogin();
      return;
    }
    state.checkoutStep = "delivery";
  } else if (state.checkoutStep === "delivery") {
    if (!hasDeliveryAddress()) {
      toast("Complete o endereco para entrega.");
      openEditProfile();
      return;
    }
    state.checkoutStep = "payment";
  }
  renderCart();
}

function prevCheckoutStep() {
  if (state.checkoutStep === "payment") state.checkoutStep = "delivery";
  else if (state.checkoutStep === "delivery") state.checkoutStep = "summary";
  renderCart();
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

function renderAccountPage() {
  const target = document.getElementById("accountPage");
  const page = state.accountPage;
  if (!state.customer) {
    target.innerHTML = `
      <div class="account-shell">
        <button class="back-button" type="button" data-back-store>Voltar para a loja</button>
        <section class="account-panel">
          <h1>Entrar na conta</h1>
          <p>Entre ou cadastre-se para acessar esta area.</p>
          <div class="account-actions">
            <button class="checkout-button" type="button" data-open-login>Entrar</button>
            <button class="secondary-button" type="button" data-open-register>Cadastre-se</button>
          </div>
        </section>
      </div>
    `;
    target.querySelector("[data-back-store]").onclick = () => closeProductDetail();
    target.querySelector("[data-open-login]").onclick = openLogin;
    target.querySelector("[data-open-register]").onclick = openRegister;
    return;
  }

  const customer = state.customer;
  const address = [customer.street, customer.number, customer.neighborhood, customer.city, customer.state, customer.zipCode]
    .filter(Boolean).join(" | ");
  const titles = {
    perfil: ["Meu perfil", "Dados da sua conta no site."],
    pedidos: ["Meus pedidos", "Acompanhe suas compras feitas no site."],
    carteira: ["Minha carteira", "Pagamentos, cupons e saldos."]
  };
  const [title, subtitle] = titles[page] || titles.perfil;
  const body = page === "pedidos"
    ? '<div class="account-empty">Seus pedidos finalizados aparecem aqui nas proximas etapas da loja.</div>'
    : page === "carteira"
      ? `
        <div class="wallet-default">
          <strong>Forma de pagamento</strong>
          <span>Escolha como deseja pagar nas compras do site.</span>
        </div>
        <div class="payment-options" role="radiogroup" aria-label="Forma de pagamento">
          <label class="payment-option active">
            <input name="paymentPreference" type="radio" value="pix" checked>
            <span>
              <strong>PIX</strong>
              <small>Pagamento padrao</small>
            </span>
          </label>
          <label class="payment-option">
            <input name="paymentPreference" type="radio" value="card">
            <span>
              <strong>Cartao</strong>
              <small>Use um cartao cadastrado</small>
            </span>
          </label>
        </div>
        <button class="secondary-button" type="button" data-show-card-form>Cadastrar cartao</button>
        <form id="cardForm" class="auth-form card-form" hidden>
          <label>Nome impresso no cartao<input name="holder" required></label>
          <label>Numero do cartao<input name="number" inputmode="numeric" autocomplete="cc-number" required></label>
          <div class="profile-address-grid">
            <label>Validade<input name="expiry" placeholder="MM/AA" autocomplete="cc-exp" required></label>
            <label>Bandeira<input name="brand" placeholder="Visa"></label>
          </div>
          <button class="secondary-button" type="submit">Cadastrar cartao</button>
          <p class="checkout-note">Por seguranca, o CVV nao e salvo. Guarde apenas cartoes do titular.</p>
        </form>
        <div class="saved-cards">
          ${state.cards.map((card) => `
            <div class="account-row">
              <span>${card.brand || "Cartao"} final ${card.last4}</span>
              <strong>${card.holder || "Titular"} | ${card.expiry || ""}</strong>
            </div>
          `).join("") || '<div class="account-empty">Nenhum cartao cadastrado.</div>'}
        </div>
      `
      : `
        <div class="account-row"><span>Nome</span><strong>${customer.name || "-"}</strong></div>
        <div class="account-row"><span>E-mail</span><strong>${customer.email || "-"}</strong></div>
        <div class="account-row"><span>Celular</span><strong>${customer.phone || "-"}</strong></div>
        <div class="account-row"><span>CPF</span><strong>${customer.cpf || "-"}</strong></div>
        <div class="account-row"><span>Endereco</span><strong>${address || "-"}</strong></div>
        <button class="checkout-button" type="button" data-edit-profile>Editar perfil</button>
      `;

  target.innerHTML = `
    <div class="account-shell">
      <button class="back-button" type="button" data-back-store>Voltar para a loja</button>
      <section class="account-panel">
        <div class="account-page-head">
          <div>
            <h1>${title}</h1>
            <p>${subtitle}</p>
          </div>
          <nav class="account-tabs" aria-label="Menu da conta">
            <a class="${page === "perfil" ? "active" : ""}" href="/perfil">Meu perfil</a>
            <a class="${page === "pedidos" ? "active" : ""}" href="/pedidos">Meus pedidos</a>
            <a class="${page === "carteira" ? "active" : ""}" href="/carteira">Minha carteira</a>
          </nav>
        </div>
        <div class="account-content">${body}</div>
      </section>
    </div>
  `;
  target.querySelector("[data-back-store]").onclick = () => closeProductDetail();
  const editProfileButton = target.querySelector("[data-edit-profile]");
  if (editProfileButton) editProfileButton.onclick = openEditProfile;
  target.querySelectorAll('.payment-option input[name="paymentPreference"]').forEach((input) => {
    input.onchange = () => {
      target.querySelectorAll(".payment-option").forEach((option) => option.classList.remove("active"));
      input.closest(".payment-option").classList.add("active");
    };
  });
  const showCardForm = target.querySelector("[data-show-card-form]");
  const cardForm = target.querySelector("#cardForm");
  if (showCardForm && cardForm) {
    showCardForm.onclick = () => {
      cardForm.hidden = false;
      showCardForm.hidden = true;
      cardForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
  }
  if (cardForm) {
    cardForm.onsubmit = (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(cardForm).entries());
      const digits = String(payload.number || "").replace(/\D/g, "");
      if (digits.length < 12) return toast("Informe um numero de cartao valido.");
      saveCards([
        ...state.cards,
        {
          id: `card_${Date.now()}`,
          holder: String(payload.holder || "").trim(),
          brand: String(payload.brand || "").trim(),
          expiry: String(payload.expiry || "").trim(),
          last4: digits.slice(-4)
        }
      ]);
      cardForm.reset();
      renderAccountPage();
      toast("Cartao cadastrado.");
    };
  }
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
  if (state.checkoutStep === "done") {
    state.checkoutStep = "summary";
    state.lastOrder = null;
  }
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
  if (!cartEntries().length) state.checkoutStep = "summary";
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
        const routes = { profile: "perfil", orders: "pedidos", wallet: "carteira" };
        navigateAccountPage(routes[action] || "perfil");
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
  document.getElementById("categorySelect").onchange = (event) => {
    state.activeCategory = event.target.value;
    renderProducts();
  };
  document.getElementById("sortSelect").onchange = (event) => {
    state.sort = event.target.value;
    renderProducts();
  };
  window.onpopstate = () => {
    state.detailProductId = productIdFromPath();
    state.accountPage = accountPageFromPath();
    renderAll();
  };

  document.getElementById("registerZipCode").onblur = fillAddressFromCep;
  document.getElementById("editZipCode").onblur = fillAddressFromCep;
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
      renderAll();
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
      renderAll();
      closeAuthModals();
      toast("Cadastro realizado.");
    } catch (error) {
      toast(error.message);
    }
  };
  document.getElementById("editProfileForm").onsubmit = async (event) => {
    event.preventDefault();
    if (!state.customer) return openLogin();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.lgpdAccepted = form.lgpdAccepted.checked;

    try {
      const customer = await api(`/api/storefront/customers/${state.customer.id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      saveCustomer(customer);
      form.reset();
      renderAll();
      closeAuthModals();
      toast("Perfil atualizado.");
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
    if (state.checkoutStep !== "payment") {
      nextCheckoutStep();
      return;
    }
    if (!hasDeliveryAddress()) {
      toast("Complete o endereco para entrega.");
      openEditProfile();
      return;
    }

    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.customerName = state.customer.name || payload.customerName;
    payload.customerEmail = state.customer.email || payload.customerEmail;
    payload.customerPhone = state.customer.phone || payload.customerPhone;
    payload.customerCpf = state.customer.cpf || "";
    payload.customerId = state.customer.id;
    payload.deliveryAddress = {
      zipCode: state.customer.zipCode || "",
      street: state.customer.street || "",
      number: state.customer.number || "",
      complement: state.customer.complement || "",
      neighborhood: state.customer.neighborhood || "",
      city: state.customer.city || "",
      state: state.customer.state || ""
    };
    const selectedPayment = document.querySelector('input[name="checkoutPayment"]:checked');
    payload.paymentMethod = selectedPayment ? selectedPayment.value : "PIX";
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
      state.checkoutStep = "done";
      state.lastOrder = result;
      saveCart();
      await loadStorefront();
      toast(`Pedido ${result.orderId} pago e confirmado.`);
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

    const form = event.currentTarget.closest("form");
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
