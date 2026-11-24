(function() {
  const config = window.JOAO_SUPABASE_CONFIG || {};
  const url = typeof config.url === "string" ? config.url.trim() : "";
  const anonKey = typeof config.anonKey === "string" ? config.anonKey.trim() : "";
  const placeholder = !url || !anonKey || url.includes("SEU-PROJETO") || anonKey.includes("SUA_CHAVE");
  const unsafeKey = /service_role|sb_secret/i.test(anonKey);

  window.JoaoSupabase = {
    client: null,
    configured: false,
    error: ""
  };

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    window.JoaoSupabase.error = "Não foi possível carregar o cliente do Supabase. Verifique sua conexão e tente novamente.";
    return;
  }

  if (placeholder) {
    window.JoaoSupabase.error = "Configure a URL e a chave publishable do seu projeto Supabase no arquivo supabase-config.js.";
    return;
  }

  if (unsafeKey) {
    window.JoaoSupabase.error = "Não use uma chave secreta ou service_role no navegador. Configure somente a chave publishable/anon.";
    return;
  }

  window.JoaoSupabase.client = window.supabase.createClient(url, anonKey);
  window.JoaoSupabase.configured = true;
})();
