const db = window.JoaoSupabase.client;
const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const panelMessage = document.getElementById("panel-message");
const scheduleList = document.getElementById("schedule-list");

let currentUser = null;
let currentMember = null;
let demoMode = false;
let barbers = [];
let services = [];
let appointments = [];
let blocks = [];
let demoAppointments = [];
let demoBlocks = [];
let weekOffset = 0;
let privacyHidden = false;

function showMessage(element, message, isError) {
  element.textContent = message;
  element.classList.toggle("error", Boolean(isError));
  element.hidden = false;
}

function clearMessage(element) {
  element.textContent = "";
  element.hidden = true;
}

function stopDemoMutation(event) {
  if (!demoMode) return false;
  event.preventDefault();
  showMessage(panelMessage, "A demonstração é somente leitura; nenhuma alteração será salva.", false);
  return true;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function getWeekDates() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const day = today.getDay();
  const monday = addDays(today, (day === 0 ? -6 : 1 - day) + (weekOffset * 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return { date, iso: localDate(date) };
  });
}

function formatDay(date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }).format(date);
}

function isAdmin() {
  return Boolean(currentMember && currentMember.is_admin);
}

function activeBarbers() {
  return barbers.filter((barber) => barber.ativo);
}

function currentBarberFilter() {
  if (!isAdmin()) return currentMember.barbeiro_id;
  return document.getElementById("barber-filter").value || "";
}

function fillSelect(select, options, placeholder, includeAll) {
  select.replaceChildren();
  if (includeAll) select.add(new Option("Todos os barbeiros", ""));
  else select.add(new Option(placeholder, ""));
  options.forEach((barber) => select.add(new Option(barber.nome, barber.id)));
}

function populateBarberControls() {
  const active = activeBarbers();
  const filter = document.getElementById("barber-filter");
  const manual = document.getElementById("manual-barber");
  const block = document.getElementById("block-barber");
  const hours = document.getElementById("hours-barber");

  if (isAdmin()) {
    fillSelect(filter, active, "Todos os barbeiros", true);
    fillSelect(manual, active, "Selecione o barbeiro", false);
    fillSelect(block, active, "Selecione o barbeiro", false);
    fillSelect(hours, active, "Selecione o barbeiro", false);
  } else {
    const ownBarber = barbers.find((barber) => barber.id === currentMember.barbeiro_id);
    filter.replaceChildren(new Option(ownBarber ? ownBarber.nome : "Minha agenda", currentMember.barbeiro_id || ""));
    manual.replaceChildren(new Option(ownBarber ? ownBarber.nome : "Minha agenda", currentMember.barbeiro_id || ""));
    block.replaceChildren(new Option(ownBarber ? ownBarber.nome : "Minha agenda", currentMember.barbeiro_id || ""));
  }
}

function enableRoleFeatures() {
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = !isAdmin();
  });
  document.getElementById("settings-pane").hidden = !isAdmin();
  document.getElementById("panel-role-label").textContent = isAdmin()
    ? "Painel administrativo"
    : "Agenda do barbeiro";
}

async function establishSession(user) {
  demoMode = false;
  document.getElementById("demo-banner").hidden = true;
  clearMessage(loginMessage);
  const { data: member, error } = await db
    .from("joao_membros")
    .select("user_id,barbeiro_id,is_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !member) {
    await db.auth.signOut();
    showMessage(loginMessage, error
      ? `Não foi possível validar o acesso: ${error.message}`
      : "Esta conta ainda não tem acesso ao painel. Peça ao administrador para associá-la em joao_membros.", true);
    return;
  }

  currentUser = user;
  currentMember = member;
  document.getElementById("panel-user-name").textContent = user.email || "Equipe";
  loginView.hidden = true;
  dashboardView.hidden = false;
  enableRoleFeatures();

  const { data: barberRows, error: barberError } = await db
    .from("joao_barbeiros")
    .select("id,nome,telefone,ativo")
    .order("nome");
  if (barberError) {
    showMessage(panelMessage, `Erro ao carregar barbeiros: ${barberError.message}`, true);
    return;
  }

  barbers = barberRows || [];
  if (!isAdmin() && !barbers.some((barber) => barber.id === currentMember.barbeiro_id)) {
    showMessage(panelMessage, "O perfil desta conta não está vinculado a um barbeiro ativo.", true);
    return;
  }

  populateBarberControls();
  const today = localDate(new Date());
  document.getElementById("manual-date").value = today;
  document.getElementById("manual-date").min = today;
  document.getElementById("block-date").value = today;
  document.getElementById("block-date").min = today;
  document.getElementById("reschedule-date").min = today;

  const { data: serviceRows, error: serviceError } = await db
    .from("joao_servicos")
    .select("id,nome,preco,duracao_minutos,ativo")
    .order("nome");
  if (serviceError) {
    showMessage(panelMessage, `Erro ao carregar serviços: ${serviceError.message}`, true);
    return;
  }
  services = serviceRows || [];
  renderManualServices();

  if (isAdmin()) await loadSettings();
  await loadDashboard();
}

function disableDemoControls() {
  ["manual-form", "block-form", "service-form", "barber-form", "hours-form", "reschedule-form"].forEach((formId) => {
    document.querySelectorAll(`#${formId} input, #${formId} select, #${formId} button`).forEach((control) => {
      control.disabled = true;
    });
  });
  document.querySelectorAll("#settings-pane button").forEach((button) => {
    button.disabled = true;
  });
}

async function establishDemoSession() {
  demoMode = true;
  weekOffset = 0;
  currentUser = { id: "demo-user", email: "Demonstração" };
  currentMember = { user_id: "demo-user", barbeiro_id: "demo-barber", is_admin: true };
  barbers = [{
    id: "demo-barber",
    nome: "João Ribeiro",
    telefone: "",
    ativo: true
  }];
  services = [
    { id: "demo-cut", nome: "Corte masculino", preco: 35, duracao_minutos: 30, ativo: true },
    { id: "demo-beard", nome: "Barba", preco: 25, duracao_minutos: 30, ativo: true },
    { id: "demo-combo", nome: "Corte + barba", preco: 55, duracao_minutos: 50, ativo: true }
  ];

  const sampleDate = getWeekDates()[2].iso;
  demoAppointments = [
    {
      id: "demo-appointment-1",
      barbeiro_id: "demo-barber",
      cliente: "Cliente exemplo 01",
      telefone: "",
      servicos_resumo: "Corte masculino",
      preco_total: 35,
      duracao_minutos: 30,
      data: sampleDate,
      horario: "10:00",
      status: "concluido",
      pagamento: "Pix"
    },
    {
      id: "demo-appointment-2",
      barbeiro_id: "demo-barber",
      cliente: "Cliente exemplo 02",
      telefone: "",
      servicos_resumo: "Corte + barba",
      preco_total: 55,
      duracao_minutos: 50,
      data: sampleDate,
      horario: "14:00",
      status: "confirmado",
      pagamento: null
    },
    {
      id: "demo-appointment-3",
      barbeiro_id: "demo-barber",
      cliente: "Cliente exemplo 03",
      telefone: "",
      servicos_resumo: "Barba",
      preco_total: 25,
      duracao_minutos: 30,
      data: sampleDate,
      horario: "16:00",
      status: "pendente",
      pagamento: null
    }
  ];
  demoBlocks = [];

  clearMessage(loginMessage);
  document.getElementById("demo-banner").hidden = false;
  document.getElementById("panel-user-name").textContent = "Acesso de demonstração";
  loginView.hidden = true;
  dashboardView.hidden = false;
  enableRoleFeatures();
  populateBarberControls();

  const today = localDate(new Date());
  document.getElementById("manual-date").value = today;
  document.getElementById("manual-date").min = today;
  document.getElementById("block-date").value = today;
  document.getElementById("block-date").min = today;
  document.getElementById("reschedule-date").min = today;

  renderManualServices();
  disableDemoControls();
  await loadSettings();
  await loadDashboard();
}

async function loadBarberAppointments(startDate, endDate, barberId) {
  let query = db
    .from("joao_agendamentos")
    .select("id,barbeiro_id,cliente,telefone,servicos_resumo,servicos_snapshot,preco_total,duracao_minutos,data,horario,status,pagamento")
    .gte("data", startDate)
    .lte("data", endDate)
    .order("data", { ascending: true })
    .order("horario", { ascending: true });

  if (barberId) query = query.eq("barbeiro_id", barberId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadDashboard() {
  if (!currentMember) return;
  clearMessage(panelMessage);
  const days = getWeekDates();
  const start = days[0].iso;
  const end = days[days.length - 1].iso;
  const selectedBarberId = currentBarberFilter();

  document.getElementById("week-label").textContent =
    `${days[0].iso.split("-").reverse().join("/")} – ${days[6].iso.split("-").reverse().join("/")}`;
  scheduleList.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.textContent = "Carregando agenda...";
  scheduleList.append(loading);

  try {
    if (demoMode) {
      appointments = demoAppointments.filter((item) =>
        item.data >= start && item.data <= end && (!selectedBarberId || item.barbeiro_id === selectedBarberId)
      );
      blocks = demoBlocks.filter((item) =>
        item.data >= start && item.data <= end && (!selectedBarberId || item.barbeiro_id === selectedBarberId)
      );
    } else {
      const [appointmentRows, blockResult] = await Promise.all([
        loadBarberAppointments(start, end, selectedBarberId),
        (function() {
          let query = db
            .from("joao_bloqueios")
            .select("id,barbeiro_id,data,hora_inicio,hora_fim,dia_todo,motivo")
            .gte("data", start)
            .lte("data", end)
            .order("data");
          if (selectedBarberId) query = query.eq("barbeiro_id", selectedBarberId);
          return query;
        })()
      ]);

      if (blockResult.error) throw blockResult.error;
      appointments = appointmentRows;
      blocks = blockResult.data || [];
    }
    renderMetrics(days);
    renderAdminReport();
    renderSchedule(days);
  } catch (error) {
    scheduleList.replaceChildren();
    const message = document.createElement("div");
    message.className = "empty-state";
    message.textContent = `Não foi possível carregar a agenda: ${error.message}`;
    scheduleList.append(message);
    showMessage(panelMessage, `Erro ao carregar agenda: ${error.message}`, true);
  }
}

function renderMetrics(days) {
  const notCanceled = appointments.filter((item) => item.status !== "cancelado");
  const completed = appointments.filter((item) => item.status === "concluido");
  const totalRevenue = completed.reduce((sum, item) => sum + Number(item.preco_total || 0), 0);
  document.getElementById("metric-appointments").textContent = notCanceled.length;
  document.getElementById("metric-completed").textContent = completed.length;
  document.getElementById("metric-revenue").textContent = money(totalRevenue);
  applyPrivacyState();

  const methods = [
    ["Pix", "Pix"],
    ["Dinheiro", "Dinheiro"],
    ["Debito", "Débito"],
    ["Credito", "Crédito"]
  ];
  const paymentContainer = document.getElementById("payment-metrics");
  paymentContainer.replaceChildren();
  methods.forEach(([value, label]) => {
    const total = completed
      .filter((appointment) => appointment.pagamento === value)
      .reduce((sum, appointment) => sum + Number(appointment.preco_total || 0), 0);
    const metric = document.createElement("div");
    metric.className = "metric";
    const title = document.createElement("span");
    title.textContent = `Recebido em ${label}`;
    const amount = document.createElement("strong");
    amount.className = "sensitive";
    amount.textContent = money(total);
    metric.append(title, amount);
    paymentContainer.append(metric);
  });
  applyPrivacyState();
}

function renderAdminReport() {
  const report = document.getElementById("barber-report");
  report.replaceChildren();
  if (!isAdmin()) return;

  const table = document.createElement("table");
  table.className = "data-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Barbeiro", "Agendamentos", "Concluídos", "Faturamento"].forEach((label) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    headRow.append(cell);
  });
  head.append(headRow);
  const body = document.createElement("tbody");

  const filtered = currentBarberFilter()
    ? barbers.filter((barber) => barber.id === currentBarberFilter())
    : barbers;
  filtered.forEach((barber) => {
    const barberAppointments = appointments.filter((appointment) => appointment.barbeiro_id === barber.id);
    const completed = barberAppointments.filter((appointment) => appointment.status === "concluido");
    const revenue = completed.reduce((sum, appointment) => sum + Number(appointment.preco_total || 0), 0);
    const row = document.createElement("tr");
    [barber.nome, String(barberAppointments.filter((item) => item.status !== "cancelado").length), String(completed.length)].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    const amount = document.createElement("td");
    amount.className = "sensitive";
    amount.textContent = money(revenue);
    row.append(amount);
    body.append(row);
  });

  table.append(head, body);
  report.append(table);
  applyPrivacyState();
}

function buildActionButton(label, action, appointmentId, danger) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-button${danger ? " danger" : ""}`;
  button.dataset.action = action;
  button.dataset.appointmentId = appointmentId;
  button.textContent = label;
  return button;
}

function makeAppointmentCard(appointment) {
  const card = document.createElement("article");
  card.className = "appointment-card";

  const time = document.createElement("div");
  time.className = "appointment-time";
  time.textContent = String(appointment.horario).slice(0, 5);

  const info = document.createElement("div");
  info.className = "appointment-info";
  const client = document.createElement("strong");
  client.textContent = appointment.cliente;
  const detail = document.createElement("span");
  const barber = barbers.find((item) => item.id === appointment.barbeiro_id);
  detail.textContent = `${appointment.servicos_resumo} · ${barber ? barber.nome : "Barbeiro"}`;
  const contact = document.createElement("span");
  contact.textContent = appointment.telefone || "Telefone não informado";
  const statusLine = document.createElement("span");
  const status = document.createElement("span");
  status.className = `status ${appointment.status}`;
  status.textContent = appointment.status;
  const price = document.createElement("strong");
  price.className = "sensitive";
  price.textContent = money(appointment.preco_total);
  statusLine.append(status, document.createTextNode(" · "), price);
  info.append(client, detail, contact, statusLine);

  const actions = document.createElement("div");
  actions.className = "appointment-actions";
  if (!demoMode && appointment.status !== "cancelado" && appointment.status !== "concluido") {
    const payment = document.createElement("select");
    payment.className = "panel-input payment-select";
    payment.setAttribute("aria-label", "Forma de pagamento");
    [
      ["Pix", "Pix"],
      ["Dinheiro", "Dinheiro"],
      ["Debito", "Débito"],
      ["Credito", "Crédito"]
    ].forEach(([value, label]) => payment.add(new Option(label, value)));
    actions.append(
      payment,
      buildActionButton("Concluir", "complete", appointment.id),
      buildActionButton("Reagendar", "reschedule", appointment.id),
      buildActionButton("Cancelar", "cancel", appointment.id, true)
    );
  }
  if (!demoMode && appointment.telefone) {
    const digits = appointment.telefone.replace(/\D/g, "");
    if (digits.length >= 10) {
      const phone = digits.startsWith("55") ? digits : `55${digits}`;
      const reminder = document.createElement("a");
      reminder.className = "small-button";
      reminder.target = "_blank";
      reminder.rel = "noopener noreferrer";
      const dateText = appointment.data.split("-").reverse().join("/");
      const message = `Olá, ${appointment.cliente}! Lembrando do seu horário na Barbearia João Ribeiro com ${barber ? barber.nome : "a equipe"} em ${dateText} às ${String(appointment.horario).slice(0, 5)}.`;
      reminder.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      reminder.textContent = "WhatsApp";
      actions.append(reminder);
    }
  }

  card.append(time, info, actions);
  return card;
}

function makeBlockCard(block) {
  const card = document.createElement("article");
  card.className = "appointment-card";
  const time = document.createElement("div");
  time.className = "appointment-time";
  time.textContent = block.dia_todo ? "Dia todo" : `${String(block.hora_inicio).slice(0, 5)}–${String(block.hora_fim).slice(0, 5)}`;
  const info = document.createElement("div");
  info.className = "appointment-info";
  const title = document.createElement("strong");
  title.textContent = "Bloqueio de agenda";
  const reason = document.createElement("span");
  const barber = barbers.find((item) => item.id === block.barbeiro_id);
  reason.textContent = `${barber ? barber.nome : "Barbeiro"}${block.motivo ? ` · ${block.motivo}` : ""}`;
  info.append(title, reason);
  const actions = document.createElement("div");
  actions.className = "appointment-actions";
  if (!demoMode) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-button danger";
    remove.dataset.action = "remove-block";
    remove.dataset.blockId = block.id;
    remove.textContent = "Remover bloqueio";
    actions.append(remove);
  }
  card.append(time, info, actions);
  return card;
}

function renderSchedule(days) {
  scheduleList.replaceChildren();
  const visibleDays = days.filter(({ iso }) =>
    appointments.some((appointment) => appointment.data === iso)
    || blocks.some((block) => block.data === iso)
  );

  if (!visibleDays.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Não há agendamentos ou bloqueios neste período.";
    scheduleList.append(empty);
    applyPrivacyState();
    return;
  }

  visibleDays.forEach(({ date, iso }) => {
    const section = document.createElement("section");
    section.className = "panel-section";
    const heading = document.createElement("h3");
    heading.textContent = formatDay(date);
    section.append(heading);

    const dayItems = [
      ...appointments.filter((appointment) => appointment.data === iso).map((appointment) => ({ type: "appointment", data: appointment })),
      ...blocks.filter((block) => block.data === iso).map((block) => ({ type: "block", data: block }))
    ].sort((a, b) => {
      const first = a.type === "block" && a.data.dia_todo ? "00:00" : String(a.data.horario || a.data.hora_inicio || "00:00");
      const second = b.type === "block" && b.data.dia_todo ? "00:00" : String(b.data.horario || b.data.hora_inicio || "00:00");
      return first.localeCompare(second);
    });
    dayItems.forEach((item) => {
      section.append(item.type === "appointment" ? makeAppointmentCard(item.data) : makeBlockCard(item.data));
    });
    scheduleList.append(section);
  });
  applyPrivacyState();
}

function applyPrivacyState() {
  document.querySelectorAll(".sensitive").forEach((element) => {
    element.classList.toggle("is-hidden", privacyHidden);
  });
  const button = document.getElementById("privacy-toggle");
  button.textContent = privacyHidden ? "Exibir valores" : "Ocultar valores";
  button.setAttribute("aria-pressed", String(privacyHidden));
}

function renderManualServices() {
  const container = document.getElementById("manual-services");
  container.replaceChildren();
  const active = services.filter((service) => service.ativo);
  if (!active.length) {
    const empty = document.createElement("p");
    empty.className = "notice";
    empty.textContent = "Cadastre um serviço antes de criar agendamentos.";
    container.append(empty);
    return;
  }

  active.forEach((service) => {
    const label = document.createElement("label");
    label.className = "choice-card";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = service.id;
    checkbox.style.width = "auto";
    checkbox.style.minHeight = "auto";
    checkbox.style.accentColor = "var(--gold)";
    const text = document.createElement("strong");
    text.textContent = service.nome;
    const detail = document.createElement("span");
    detail.textContent = `${service.duracao_minutos} min · ${money(service.preco)}`;
    label.append(checkbox, text, detail);
    container.append(label);
  });
  updateManualTotal();
}

function updateManualTotal() {
  const ids = new Set(Array.from(document.querySelectorAll("#manual-services input:checked")).map((input) => input.value));
  const total = services.filter((service) => ids.has(service.id)).reduce((sum, service) => sum + Number(service.preco), 0);
  document.getElementById("manual-total").textContent = `Total estimado: ${money(total)}`;
}

function createTable(headers, rows) {
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((heading) => {
    const th = document.createElement("th");
    th.textContent = heading;
    headerRow.append(th);
  });
  thead.append(headerRow);
  const tbody = document.createElement("tbody");
  rows.forEach((cells) => {
    const row = document.createElement("tr");
    cells.forEach((cell) => {
      const td = document.createElement("td");
      if (cell instanceof Node) td.append(cell);
      else td.textContent = String(cell);
      row.append(td);
    });
    tbody.append(row);
  });
  table.append(thead, tbody);
  return table;
}

async function loadSettings() {
  if (!isAdmin()) return;
  let serviceRowsData;
  let barberRowsData;
  let hoursRowsData;
  if (demoMode) {
    serviceRowsData = services;
    barberRowsData = barbers;
    hoursRowsData = [1, 2, 3, 4, 5, 6].map((day) => ({
      id: `demo-hours-${day}`,
      barbeiro_id: "demo-barber",
      dia_semana: day,
      hora_inicio: "09:00",
      hora_fim: day === 6 ? "14:00" : "18:00",
      intervalo_minutos: 30
    }));
  } else {
    const [serviceResult, barberResult, hoursResult] = await Promise.all([
      db.from("joao_servicos").select("*").order("nome"),
      db.from("joao_barbeiros").select("*").order("nome"),
      db.from("joao_horarios").select("*").order("barbeiro_id").order("dia_semana")
    ]);
    const failure = serviceResult.error || barberResult.error || hoursResult.error;
    if (failure) {
      showMessage(panelMessage, `Erro ao carregar configurações: ${failure.message}`, true);
      return;
    }
    serviceRowsData = serviceResult.data || [];
    barberRowsData = barberResult.data || [];
    hoursRowsData = hoursResult.data || [];
  }

  services = serviceRowsData;
  barbers = barberRowsData;
  populateBarberControls();
  renderManualServices();

  const serviceRows = services.map((service) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-button";
    button.dataset.toggleService = service.id;
    button.textContent = service.ativo ? "Desativar" : "Ativar";
    return [service.nome, money(service.preco), `${service.duracao_minutos} min`, service.ativo ? "Ativo" : "Inativo", button];
  });
  const serviceTable = document.getElementById("service-settings-list");
  serviceTable.replaceChildren(serviceRows.length
    ? createTable(["Serviço", "Preço", "Duração", "Status", "Ação"], serviceRows)
    : createEmpty("Nenhum serviço cadastrado."));

  const barberRows = barbers.map((barber) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-button";
    button.dataset.toggleBarber = barber.id;
    button.textContent = barber.ativo ? "Desativar" : "Ativar";
    return [barber.nome, barber.telefone || "—", barber.ativo ? "Ativo" : "Inativo", button];
  });
  const barberTable = document.getElementById("barber-settings-list");
  barberTable.replaceChildren(barberRows.length
    ? createTable(["Barbeiro", "Telefone", "Status", "Ação"], barberRows)
    : createEmpty("Nenhum barbeiro cadastrado."));

  const dayNames = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
  const hoursRows = hoursRowsData.map((hours) => {
    const barber = barbers.find((item) => item.id === hours.barbeiro_id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-button danger";
    button.dataset.deleteHours = hours.id;
    button.textContent = "Remover";
    return [
      barber ? barber.nome : "Barbeiro",
      dayNames[hours.dia_semana],
      `${String(hours.hora_inicio).slice(0, 5)}–${String(hours.hora_fim).slice(0, 5)}`,
      `${hours.intervalo_minutos} min`,
      button
    ];
  });
  const hoursTable = document.getElementById("hours-settings-list");
  hoursTable.replaceChildren(hoursRows.length
    ? createTable(["Barbeiro", "Dia", "Expediente", "Intervalo", "Ação"], hoursRows)
    : createEmpty("Nenhum horário de expediente cadastrado."));
  if (demoMode) disableDemoControls();
}

function createEmpty(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}

async function updateAppointment(id, changes, successMessage) {
  if (demoMode) return false;
  clearMessage(panelMessage);
  const { data, error } = await db
    .from("joao_agendamentos")
    .update(changes)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    showMessage(panelMessage, `Não foi possível atualizar o agendamento: ${error.message}`, true);
    return false;
  }
  if (!data) {
    showMessage(panelMessage, "O agendamento não foi encontrado ou sua conta não pode alterá-lo.", true);
    return false;
  }
  showMessage(panelMessage, successMessage, false);
  await loadDashboard();
  return true;
}

scheduleList.addEventListener("click", async (event) => {
  if (demoMode) return;
  const actionButton = event.target.closest("button[data-action]");
  if (actionButton) {
    const appointment = appointments.find((item) => item.id === actionButton.dataset.appointmentId);
    if (!appointment) {
      showMessage(panelMessage, "O agendamento não está mais disponível na agenda.", true);
      return;
    }

    if (actionButton.dataset.action === "complete") {
      const payment = actionButton.parentElement.querySelector(".payment-select").value;
      await updateAppointment(appointment.id, { status: "concluido", pagamento: payment }, "Atendimento concluído.");
    } else if (actionButton.dataset.action === "cancel") {
      if (window.confirm(`Cancelar o horário de ${appointment.cliente}?`)) {
        await updateAppointment(appointment.id, { status: "cancelado" }, "Agendamento cancelado.");
      }
    } else if (actionButton.dataset.action === "reschedule") {
      document.getElementById("reschedule-id").value = appointment.id;
      document.getElementById("reschedule-date").value = appointment.data;
      document.getElementById("reschedule-time").value = String(appointment.horario).slice(0, 5);
      document.getElementById("reschedule-dialog").showModal();
    }
    return;
  }

  const blockButton = event.target.closest("button[data-block-id]");
  if (blockButton && window.confirm("Remover este bloqueio da agenda?")) {
    const { error } = await db.from("joao_bloqueios").delete().eq("id", blockButton.dataset.blockId);
    if (error) {
      showMessage(panelMessage, `Não foi possível remover o bloqueio: ${error.message}`, true);
      return;
    }
    showMessage(panelMessage, "Bloqueio removido.", false);
    await loadDashboard();
  }
});

document.getElementById("reschedule-form").addEventListener("submit", async (event) => {
  if (stopDemoMutation(event)) return;
  event.preventDefault();
  const id = document.getElementById("reschedule-id").value;
  const data = document.getElementById("reschedule-date").value;
  const horario = document.getElementById("reschedule-time").value;
  if (!data || !horario) return;
  const saved = await updateAppointment(id, { data, horario }, "Agendamento reagendado.");
  if (saved) document.getElementById("reschedule-dialog").close();
});

function closeRescheduleDialog() {
  document.getElementById("reschedule-dialog").close();
}
document.getElementById("close-reschedule").addEventListener("click", closeRescheduleDialog);
document.getElementById("cancel-reschedule").addEventListener("click", closeRescheduleDialog);

document.getElementById("manual-services").addEventListener("change", updateManualTotal);
document.getElementById("manual-form").addEventListener("submit", async (event) => {
  if (stopDemoMutation(event)) return;
  event.preventDefault();
  clearMessage(panelMessage);
  const barberId = isAdmin() ? document.getElementById("manual-barber").value : currentMember.barbeiro_id;
  const serviceIds = Array.from(document.querySelectorAll("#manual-services input:checked")).map((input) => input.value);
  const button = document.getElementById("manual-submit");
  if (!barberId || !serviceIds.length) {
    showMessage(panelMessage, "Selecione um barbeiro e pelo menos um serviço.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Salvando...";
  const { error } = await db.rpc("joao_criar_agendamento", {
    p_barbeiro_id: barberId,
    p_data: document.getElementById("manual-date").value,
    p_horario: document.getElementById("manual-time").value,
    p_cliente: document.getElementById("manual-client").value.trim(),
    p_telefone: document.getElementById("manual-phone").value.trim(),
    p_servico_ids: serviceIds,
    p_origem: "painel"
  });
  button.disabled = false;
  button.textContent = "Salvar agendamento";

  if (error) {
    showMessage(panelMessage, `Não foi possível salvar o agendamento: ${error.message}`, true);
    return;
  }

  event.target.reset();
  document.getElementById("manual-date").value = localDate(new Date());
  updateManualTotal();
  showMessage(panelMessage, "Agendamento adicionado à agenda.", false);
  await loadDashboard();
});

document.getElementById("block-full-day").addEventListener("change", (event) => {
  const disabled = event.target.checked;
  document.getElementById("block-start").disabled = disabled;
  document.getElementById("block-end").disabled = disabled;
});

document.getElementById("block-form").addEventListener("submit", async (event) => {
  if (stopDemoMutation(event)) return;
  event.preventDefault();
  clearMessage(panelMessage);
  const fullDay = document.getElementById("block-full-day").checked;
  const barberId = isAdmin() ? document.getElementById("block-barber").value : currentMember.barbeiro_id;
  const start = document.getElementById("block-start").value;
  const end = document.getElementById("block-end").value;

  if (!barberId || (!fullDay && (!start || !end || start >= end))) {
    showMessage(panelMessage, "Selecione o barbeiro e um intervalo válido, ou marque dia inteiro.", true);
    return;
  }

  const { error } = await db.from("joao_bloqueios").insert({
    barbeiro_id: barberId,
    data: document.getElementById("block-date").value,
    hora_inicio: fullDay ? null : start,
    hora_fim: fullDay ? null : end,
    dia_todo: fullDay,
    motivo: document.getElementById("block-reason").value.trim()
  });
  if (error) {
    showMessage(panelMessage, `Não foi possível criar o bloqueio: ${error.message}`, true);
    return;
  }

  event.target.reset();
  document.getElementById("block-date").value = localDate(new Date());
  document.getElementById("block-start").disabled = false;
  document.getElementById("block-end").disabled = false;
  showMessage(panelMessage, "Bloqueio registrado.", false);
  await loadDashboard();
});

document.getElementById("service-form").addEventListener("submit", async (event) => {
  if (stopDemoMutation(event)) return;
  event.preventDefault();
  const service = {
    nome: document.getElementById("service-name").value.trim(),
    preco: Number(document.getElementById("service-price").value),
    duracao_minutos: Number(document.getElementById("service-duration").value)
  };
  const { error } = await db.from("joao_servicos").insert(service);
  if (error) {
    showMessage(panelMessage, `Não foi possível cadastrar o serviço: ${error.message}`, true);
    return;
  }
  event.target.reset();
  showMessage(panelMessage, "Serviço cadastrado.", false);
  await loadSettings();
  await loadDashboard();
});

document.getElementById("barber-form").addEventListener("submit", async (event) => {
  if (stopDemoMutation(event)) return;
  event.preventDefault();
  const barber = {
    nome: document.getElementById("barber-name").value.trim(),
    telefone: document.getElementById("barber-phone").value.trim() || null
  };
  const { error } = await db.from("joao_barbeiros").insert(barber);
  if (error) {
    showMessage(panelMessage, `Não foi possível cadastrar o barbeiro: ${error.message}`, true);
    return;
  }
  event.target.reset();
  showMessage(panelMessage, "Barbeiro cadastrado. Crie e associe a conta dele ao painel conforme as instruções do SQL.", false);
  await loadSettings();
  await loadDashboard();
});

document.getElementById("hours-form").addEventListener("submit", async (event) => {
  if (stopDemoMutation(event)) return;
  event.preventDefault();
  const hours = {
    barbeiro_id: document.getElementById("hours-barber").value,
    dia_semana: Number(document.getElementById("hours-day").value),
    hora_inicio: document.getElementById("hours-start").value,
    hora_fim: document.getElementById("hours-end").value,
    intervalo_minutos: Number(document.getElementById("hours-interval").value),
    ativo: true
  };
  if (!hours.barbeiro_id || hours.hora_inicio >= hours.hora_fim) {
    showMessage(panelMessage, "Selecione o barbeiro e informe um expediente válido.", true);
    return;
  }
  const { error } = await db.from("joao_horarios").upsert(hours, { onConflict: "barbeiro_id,dia_semana" });
  if (error) {
    showMessage(panelMessage, `Não foi possível salvar o expediente: ${error.message}`, true);
    return;
  }
  showMessage(panelMessage, "Expediente salvo.", false);
  await loadSettings();
});

document.getElementById("settings-pane").addEventListener("click", async (event) => {
  if (demoMode) return;
  const serviceButton = event.target.closest("button[data-toggle-service]");
  if (serviceButton) {
    const service = services.find((item) => item.id === serviceButton.dataset.toggleService);
    if (!service) return;
    const { error } = await db.from("joao_servicos").update({ ativo: !service.ativo }).eq("id", service.id);
    if (error) {
      showMessage(panelMessage, `Não foi possível atualizar o serviço: ${error.message}`, true);
      return;
    }
    await loadSettings();
    await loadDashboard();
    return;
  }

  const barberButton = event.target.closest("button[data-toggle-barber]");
  if (barberButton) {
    const barber = barbers.find((item) => item.id === barberButton.dataset.toggleBarber);
    if (!barber) return;
    const { error } = await db.from("joao_barbeiros").update({ ativo: !barber.ativo }).eq("id", barber.id);
    if (error) {
      showMessage(panelMessage, `Não foi possível atualizar o barbeiro: ${error.message}`, true);
      return;
    }
    await loadSettings();
    await loadDashboard();
    return;
  }

  const hoursButton = event.target.closest("button[data-delete-hours]");
  if (hoursButton && window.confirm("Remover este horário de expediente?")) {
    const { error } = await db.from("joao_horarios").delete().eq("id", hoursButton.dataset.deleteHours);
    if (error) {
      showMessage(panelMessage, `Não foi possível remover o expediente: ${error.message}`, true);
      return;
    }
    showMessage(panelMessage, "Expediente removido.", false);
    await loadSettings();
  }
});

document.getElementById("barber-filter").addEventListener("change", loadDashboard);
document.getElementById("previous-week").addEventListener("click", async () => {
  weekOffset -= 1;
  await loadDashboard();
});
document.getElementById("next-week").addEventListener("click", async () => {
  weekOffset += 1;
  await loadDashboard();
});
document.getElementById("refresh-agenda").addEventListener("click", loadDashboard);
document.getElementById("privacy-toggle").addEventListener("click", () => {
  privacyHidden = !privacyHidden;
  applyPrivacyState();
});

document.querySelectorAll("[data-panel-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.dataset.panelTab;
    document.querySelectorAll("[data-panel-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll("[data-panel-pane]").forEach((pane) => {
      pane.hidden = pane.id !== targetId || (pane.id === "settings-pane" && !isAdmin());
    });
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage(loginMessage);
  const username = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (username.toLowerCase() === "joao") {
    if (password !== "admin123") {
      showMessage(loginMessage, "A senha do acesso de demonstração está incorreta.", true);
      return;
    }
    await establishDemoSession();
    return;
  }
  if (!window.JoaoSupabase.configured) {
    showMessage(loginMessage, window.JoaoSupabase.error, true);
    return;
  }
  if (!username.includes("@")) {
    showMessage(loginMessage, "Para acessar dados reais, informe o e-mail cadastrado no Supabase.", true);
    return;
  }

  const button = document.getElementById("login-submit");
  button.disabled = true;
  button.textContent = "Entrando...";
  const { data, error } = await db.auth.signInWithPassword({
    email: username,
    password
  });
  button.disabled = false;
  button.textContent = "Entrar no painel";

  if (error) {
    showMessage(loginMessage, `Não foi possível entrar: ${error.message}`, true);
    return;
  }
  await establishSession(data.user);
});

document.getElementById("logout-button").addEventListener("click", async () => {
  if (demoMode) {
    demoMode = false;
    currentUser = null;
    currentMember = null;
    demoAppointments = [];
    demoBlocks = [];
    document.getElementById("demo-banner").hidden = true;
    dashboardView.hidden = true;
    loginView.hidden = false;
    loginForm.reset();
    clearMessage(loginMessage);
    return;
  }
  const { error } = await db.auth.signOut();
  if (error) {
    showMessage(panelMessage, `Não foi possível encerrar a sessão: ${error.message}`, true);
    return;
  }
  currentUser = null;
  currentMember = null;
  dashboardView.hidden = true;
  loginView.hidden = false;
});

async function startPanel() {
  if (!window.JoaoSupabase.configured) return;
  const { data, error } = await db.auth.getSession();
  if (error) {
    showMessage(loginMessage, `Não foi possível verificar a sessão: ${error.message}`, true);
    return;
  }
  if (data.session) await establishSession(data.session.user);
}

startPanel().catch((error) => {
  showMessage(loginMessage, `Erro ao iniciar o painel: ${error.message}`, true);
});
