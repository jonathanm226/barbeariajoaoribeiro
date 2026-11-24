const siteNotice = document.getElementById("site-notice");
const serviceList = document.getElementById("service-list");
const navToggle = document.querySelector(".menu-toggle");
const mainNav = document.getElementById("main-nav");

navToggle.addEventListener("click", function() {
  const isOpen = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Abrir menu" : "Fechar menu");
  mainNav.classList.toggle("is-open", !isOpen);
});

mainNav.addEventListener("click", function(event) {
  if (event.target.closest("a")) {
    mainNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Abrir menu");
  }
});

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function renderServices(services) {
  serviceList.replaceChildren();

  if (services.length === 0) {
    const message = document.createElement("p");
    message.className = "notice service-empty";
    message.textContent = "Os serviços serão publicados em breve. Fale com a barbearia para consultar as opções.";
    serviceList.append(message);
    return;
  }

  services.forEach(function(service, index) {
    const card = document.createElement("article");
    card.className = "service-card";

    const number = document.createElement("span");
    number.className = "service-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("h3");
    title.textContent = service.nome;

    const details = document.createElement("p");
    details.textContent = `${service.duracao_minutos} min de atendimento`;

    const price = document.createElement("span");
    price.className = "service-price";
    price.textContent = formatCurrency(Number(service.preco));

    card.append(number, title, details, price);
    serviceList.append(card);
  });
}

async function loadServices() {
  if (!window.JoaoSupabase.configured) {
    renderServices([]);
    siteNotice.textContent = window.JoaoSupabase.error;
    siteNotice.hidden = false;
    return;
  }

  const { data, error } = await window.JoaoSupabase.client
    .from("joao_servicos")
    .select("id,nome,preco,duracao_minutos")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    renderServices([]);
    siteNotice.textContent = `Não foi possível carregar os serviços: ${error.message}`;
    siteNotice.hidden = false;
    return;
  }

  siteNotice.hidden = true;
  renderServices(data || []);
}

loadServices().catch((error) => {
  renderServices([]);
  siteNotice.textContent = `Erro inesperado ao carregar os serviços: ${error.message}`;
  siteNotice.hidden = false;
});
