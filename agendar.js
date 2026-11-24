const db = window.JoaoSupabase.client;
const bookingNotice = document.getElementById("booking-notice");
const bookingForm = document.getElementById("booking-form");
const barberSelect = document.getElementById("barber-select");
const bookingDate = document.getElementById("booking-date");
const serviceOptions = document.getElementById("service-options");
const timeOptions = document.getElementById("time-options");
const submitBooking = document.getElementById("submit-booking");

const barbers = new Map();
const services = new Map();
const selectedServiceIds = new Set();
let selectedTime = "";
let selectedSchedule = null;
let bookingInProgress = false;
let timeQueryVersion = 0;

function showBookingNotice(message, isError) {
  bookingNotice.textContent = message;
  bookingNotice.classList.toggle("error", Boolean(isError));
  bookingNotice.hidden = false;
}

function clearBookingNotice() {
  bookingNotice.hidden = true;
  bookingNotice.textContent = "";
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayOfWeekIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

function minutes(value) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function timeText(value) {
  return String(value).slice(0, 5);
}

function clockText(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function selectedServices() {
  return Array.from(selectedServiceIds).map((id) => services.get(id)).filter(Boolean);
}

function selectedDuration() {
  return selectedServices().reduce((total, service) => total + service.duracao_minutos, 0);
}

function updateSummary() {
  const barber = barbers.get(barberSelect.value);
  const chosenServices = selectedServices();
  const total = chosenServices.reduce((sum, service) => sum + Number(service.preco), 0);
  document.getElementById("summary-barber").textContent = barber ? barber.nome : "—";
  document.getElementById("summary-services").textContent = chosenServices.length
    ? chosenServices.map((service) => service.nome).join(", ")
    : "Selecione serviços";
  document.getElementById("summary-datetime").textContent =
    bookingDate.value && selectedTime ? `${bookingDate.value.split("-").reverse().join("/")} às ${selectedTime}` : "—";
  document.getElementById("summary-total").textContent = money(total);
  submitBooking.disabled = bookingInProgress || !barber || !chosenServices.length || !bookingDate.value || !selectedTime;
}

function renderServices(rows) {
  serviceOptions.replaceChildren();
  services.clear();
  selectedServiceIds.clear();

  if (!rows.length) {
    const message = document.createElement("p");
    message.className = "notice";
    message.textContent = "Nenhum serviço está disponível para agendamento no momento.";
    serviceOptions.append(message);
    updateSummary();
    return;
  }

  rows.forEach((service) => {
    services.set(service.id, service);
    const button = document.createElement("button");
    button.className = "choice-card";
    button.type = "button";
    button.setAttribute("aria-pressed", "false");

    const name = document.createElement("strong");
    name.textContent = service.nome;
    const info = document.createElement("span");
    info.textContent = `${service.duracao_minutos} min · ${money(Number(service.preco))}`;
    button.append(name, info);

    button.addEventListener("click", async () => {
      if (selectedServiceIds.has(service.id)) {
        selectedServiceIds.delete(service.id);
        button.classList.remove("selected");
        button.setAttribute("aria-pressed", "false");
      } else {
        selectedServiceIds.add(service.id);
        button.classList.add("selected");
        button.setAttribute("aria-pressed", "true");
      }
      selectedTime = "";
      updateSummary();
      await loadTimes();
    });

    serviceOptions.append(button);
  });
  updateSummary();
}

async function loadInitialData() {
  if (!window.JoaoSupabase.configured) {
    showBookingNotice(window.JoaoSupabase.error, true);
    barberSelect.disabled = true;
    bookingDate.disabled = true;
    timeOptions.textContent = "O agendamento estará disponível após a configuração do Supabase.";
    return;
  }

  bookingDate.min = localDate(new Date());
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 21);
  bookingDate.max = localDate(maxDate);
  bookingDate.value = localDate(new Date());

  const [barberResult, serviceResult] = await Promise.all([
    db.from("joao_barbeiros").select("id,nome").eq("ativo", true).order("nome"),
    db.from("joao_servicos").select("id,nome,preco,duracao_minutos").eq("ativo", true).order("nome")
  ]);

  if (barberResult.error || serviceResult.error) {
    showBookingNotice(`Não foi possível carregar a agenda: ${(barberResult.error || serviceResult.error).message}`, true);
    return;
  }

  barberSelect.replaceChildren(new Option("Selecione o barbeiro", ""));
  (barberResult.data || []).forEach((barber) => {
    barbers.set(barber.id, barber);
    barberSelect.add(new Option(barber.nome, barber.id));
  });
  barberSelect.disabled = !barbers.size;
  bookingDate.disabled = !barbers.size;
  renderServices(serviceResult.data || []);

  if (!barbers.size) {
    showBookingNotice("Nenhum barbeiro está disponível para agendamento no momento.", true);
  } else {
    clearBookingNotice();
  }
}

async function loadTimes() {
  const queryVersion = ++timeQueryVersion;
  selectedTime = "";
  updateSummary();
  timeOptions.replaceChildren();

  if (!barberSelect.value || !bookingDate.value || selectedServiceIds.size === 0) {
    timeOptions.textContent = "Escolha barbeiro, serviços e data para ver os horários.";
    selectedSchedule = null;
    return;
  }

  const weekday = dayOfWeekIso(bookingDate.value);
  let scheduleResult;
  let occupiedResult;
  try {
    [scheduleResult, occupiedResult] = await Promise.all([
      db.from("joao_horarios")
        .select("hora_inicio,hora_fim,intervalo_minutos")
        .eq("barbeiro_id", barberSelect.value)
        .eq("dia_semana", weekday)
        .eq("ativo", true)
        .maybeSingle(),
      db.rpc("joao_horarios_ocupados", {
        p_barbeiro_id: barberSelect.value,
        p_data: bookingDate.value
      })
    ]);
  } catch (error) {
    if (queryVersion !== timeQueryVersion) return;
    showBookingNotice(`Erro inesperado ao consultar horários: ${error.message}`, true);
    timeOptions.textContent = "Não foi possível consultar os horários. Tente novamente.";
    return;
  }

  if (queryVersion !== timeQueryVersion) return;

  if (scheduleResult.error || occupiedResult.error) {
    showBookingNotice(`Erro ao consultar horários: ${(scheduleResult.error || occupiedResult.error).message}`, true);
    timeOptions.textContent = "Não foi possível consultar os horários. Tente novamente.";
    return;
  }

  selectedSchedule = scheduleResult.data;
  if (!selectedSchedule) {
    timeOptions.textContent = "Não há expediente configurado para este barbeiro neste dia.";
    return;
  }

  const start = minutes(selectedSchedule.hora_inicio);
  const end = minutes(selectedSchedule.hora_fim);
  const interval = Number(selectedSchedule.intervalo_minutos);
  const duration = selectedDuration();
  const busy = occupiedResult.data || [];
  const today = localDate(new Date());
  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  let freeCount = 0;

  for (let slot = start; slot + duration <= end; slot += interval) {
    const slotEnd = slot + duration;
    const blocked = busy.some((item) => {
      if (item.dia_todo) return true;
      const busyStart = minutes(item.inicio);
      const busyEnd = busyStart + Number(item.duracao_minutos);
      return slot < busyEnd && busyStart < slotEnd;
    });
    const isPast = bookingDate.value === today && slot <= currentMinutes;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-choice";
    button.textContent = clockText(slot);
    button.disabled = blocked || isPast;
    button.setAttribute("aria-pressed", "false");
    if (!button.disabled) freeCount += 1;

    button.addEventListener("click", () => {
      timeOptions.querySelectorAll(".time-choice").forEach((choice) => {
        choice.classList.remove("selected");
        choice.setAttribute("aria-pressed", "false");
      });
      selectedTime = clockText(slot);
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
      updateSummary();
    });
    timeOptions.append(button);
  }

  if (!timeOptions.children.length) {
    timeOptions.textContent = "Não há horários disponíveis para a duração dos serviços selecionados.";
  } else if (!freeCount) {
    const note = document.createElement("p");
    note.className = "notice";
    note.textContent = "Todos os horários deste dia já passaram ou estão ocupados.";
    timeOptions.append(note);
  }
}

barberSelect.addEventListener("change", async () => {
  selectedTime = "";
  updateSummary();
  await loadTimes();
});
bookingDate.addEventListener("change", loadTimes);
bookingDate.addEventListener("input", loadTimes);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearBookingNotice();

  const clientName = document.getElementById("client-name").value.trim();
  const phone = document.getElementById("client-phone").value.trim();
  const digits = phone.replace(/\D/g, "");
  const serviceIds = Array.from(selectedServiceIds);

  if (digits.length < 10 || digits.length > 15) {
    showBookingNotice("Informe um telefone válido com DDD.", true);
    return;
  }
  if (!selectedSchedule || !selectedTime || !serviceIds.length) {
    showBookingNotice("Selecione barbeiro, serviços, data e horário.", true);
    return;
  }

  bookingInProgress = true;
  submitBooking.textContent = "Registrando solicitação...";
  updateSummary();

  let result;
  try {
    result = await db.rpc("joao_criar_agendamento", {
      p_barbeiro_id: barberSelect.value,
      p_data: bookingDate.value,
      p_horario: selectedTime,
      p_cliente: clientName,
      p_telefone: phone,
      p_servico_ids: serviceIds,
      p_origem: "site"
    });
  } catch (error) {
    bookingInProgress = false;
    submitBooking.textContent = "Solicitar agendamento";
    updateSummary();
    showBookingNotice(`Erro inesperado ao registrar o horário: ${error.message}`, true);
    return;
  }

  const { data, error } = result;
  bookingInProgress = false;
  submitBooking.textContent = "Solicitar agendamento";

  if (error) {
    showBookingNotice(error.message || "Não foi possível registrar o horário. Escolha outro e tente novamente.", true);
    await loadTimes();
    updateSummary();
    return;
  }

  const selectedBarber = barbers.get(barberSelect.value);
  const selectedServiceNames = selectedServices().map((service) => service.nome).join(", ");
  const dateText = bookingDate.value.split("-").reverse().join("/");
  const details = `${selectedBarber.nome} · ${dateText} às ${selectedTime} · ${selectedServiceNames}`;
  document.getElementById("success-details").textContent = details;
  const message = `Olá! Acabei de solicitar um horário na Barbearia João Ribeiro:\n${details}.\nMeu nome: ${clientName}.\nCódigo da solicitação: ${data}`;
  document.getElementById("whatsapp-confirmation").href =
    `https://wa.me/553191852472?text=${encodeURIComponent(message)}`;
  document.getElementById("booking-content").hidden = true;
  document.getElementById("booking-success").hidden = false;
  document.getElementById("booking-success").scrollIntoView({ behavior: "smooth", block: "start" });
});

loadInitialData().then(loadTimes).catch((error) => {
  showBookingNotice(`Erro inesperado ao iniciar o agendamento: ${error.message}`, true);
});
