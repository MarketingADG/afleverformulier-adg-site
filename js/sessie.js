/* ==========================================================================
   Inloggen, sessie en databaseaanroepen. Gedeeld door alle pagina's.

   Laadvolgorde op elke pagina:
     supabase-js (CDN) → js/config.js → js/gegevens.js → js/sessie.js → eigen script

   Hoe de beveiliging werkt (zelfde model als de BYD-offertemodule):
   - Inloggen met e-mailadres en wachtwoord via de databasefunctie login(). Het
     wachtwoord wordt in de database vergeleken; de browser krijgt alleen een
     sessietoken terug, 7 dagen geldig, schuift op bij elk gebruik.
   - Het token staat in localStorage onder AUTH_KEY. Elke databasefunctie controleert
     het token zelf, dus wat hier in de browser staat bepaalt niets: iemand die de
     gecachte rechten aanpast, krijgt van de database alsnog "geen toegang".
   - Na 20 minuten niets doen logt de pagina uit (gedeelde showroomcomputers).
   ========================================================================== */

const AUTH_KEY = "adgAfleverAuth";
const IDLE_MS = 20 * 60 * 1000;

const sb = (typeof supabase !== "undefined" && AFLEVER_CONFIG.key && AFLEVER_CONFIG.key !== "VUL_IN")
  ? supabase.createClient(AFLEVER_CONFIG.url, AFLEVER_CONFIG.key, { auth: { persistSession: false } })
  : null;

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; }
}
function setAuth(auth) { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
function clearAuth() { localStorage.removeItem(AUTH_KEY); }

/* Eén ingang voor alle databaseaanroepen. Geeft altijd { data, error } terug, gooit nooit.
   Testhaak: zet een test vóór het laden window.AFLEVER_TEST_RPC = async (naam, params) =>
   ({ data, error }), dan gaat elke aanroep daarheen in plaats van naar Supabase. Alleen
   bedoeld om schermen in chrome-devtools te testen zonder database. Het opent niets:
   de database controleert zelf elk token en elk recht. */
async function rpc(naam, params) {
  if (typeof window.AFLEVER_TEST_RPC === "function") {
    try { return await window.AFLEVER_TEST_RPC(naam, params || {}); }
    catch (e) { return { data: null, error: { message: String((e && e.message) || e) } }; }
  }
  if (!sb) return { data: null, error: { message: "Geen verbinding met de database: js/config.js is niet ingevuld" } };
  try {
    const { data, error } = await sb.rpc(naam, params || {});
    return { data, error };
  } catch (e) {
    return { data: null, error: { message: String((e && e.message) || e) } };
  }
}

/* Aanroep met het sessietoken erbij. Bij een verlopen sessie direct naar het inlogscherm. */
async function rpcMetSessie(naam, params) {
  const auth = getAuth();
  if (!auth || !auth.token) { naarInloggen("Log eerst in."); return { data: null, error: { message: "Niet ingelogd" } }; }
  const res = await rpc(naam, Object.assign({ p_token: auth.token }, params || {}));
  if (res.error && /sessie verlopen/i.test(res.error.message || "")) {
    clearAuth();
    naarInloggen("Je sessie is verlopen, log opnieuw in.");
  }
  return res;
}

/* Naar het inlogscherm, met de reden erbij en de huidige pagina als "terug", zodat een
   verkoper na opnieuw inloggen weer bij hetzelfde formulier uitkomt. */
function naarInloggen(reden) {
  const q = new URLSearchParams();
  if (reden) q.set("reden", reden);
  const hier = location.pathname.split("/").pop() + location.search;
  if (/^[a-z]+\.html/.test(hier) && !hier.startsWith("index.html")) q.set("terug", hier);
  const s = q.toString();
  location.replace("index.html" + (s ? "?" + s : ""));
}

/* Bovenaan elke beveiligde pagina: const ik = await vereisLogin();
   Opties: { dashboard: true } voor pagina's die dashboardrecht vereisen,
           { wachtwoordPagina: true } alleen op wachtwoord.html.
   Geeft de ingelogde gebruiker terug, of null als er is doorgestuurd. De rechten komen
   live uit de database en niet uit de cache: intrekken of toekennen werkt dus bij de
   eerstvolgende pagina die iemand opent, zonder opnieuw inloggen. */
async function vereisLogin(opties) {
  opties = opties || {};
  const auth = getAuth();
  if (!auth || !auth.token) { naarInloggen(); return null; }
  const { data, error } = await rpc("sessie_check", { p_token: auth.token });
  if (error) { toonVerbindingsfout(error.message); return null; }
  const rij = Array.isArray(data) ? data[0] : data;
  if (!rij) { clearAuth(); naarInloggen("Je sessie is verlopen, log opnieuw in."); return null; }
  const ik = {
    token: auth.token,
    username: rij.username,
    naam: rij.naam || "",
    can_dashboard: !!rij.can_dashboard,
    can_bewerk_alle: !!rij.can_bewerk_alle,
    moet_wachtwoord_wijzigen: !!rij.moet_wachtwoord_wijzigen
  };
  setAuth(ik);
  /* nog op het tijdelijke wachtwoord: geen enkele andere pagina, ook niet via de adresbalk */
  if (ik.moet_wachtwoord_wijzigen && !opties.wachtwoordPagina) { location.replace("wachtwoord.html"); return null; }
  if (opties.dashboard && !ik.can_dashboard) { location.replace("start.html?geen=dashboard"); return null; }
  startIdleTimer();
  document.documentElement.classList.remove("wacht-op-login");
  return ik;
}

async function uitloggen(vraag) {
  if (vraag !== false && !confirm("Uitloggen op dit apparaat?")) return;
  const auth = getAuth();
  clearAuth();
  if (auth && auth.token) await rpc("logout", { p_token: auth.token });
  location.replace("index.html");
}

/* ---- automatisch uitloggen na 20 minuten niets doen ---- */
let idleTimer = null, idleWired = false;
function startIdleTimer() {
  if (!idleWired) {
    ["mousedown", "keydown", "touchstart", "scroll"].forEach(ev =>
      window.addEventListener(ev, resetIdleTimer, { passive: true }));
    idleWired = true;
  }
  resetIdleTimer();
}
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const auth = getAuth();
    clearAuth();
    if (auth && auth.token) await rpc("logout", { p_token: auth.token });
    naarInloggen("Automatisch uitgelogd na 20 minuten zonder activiteit.");
  }, IDLE_MS);
}

function toonVerbindingsfout(bericht) {
  document.documentElement.classList.remove("wacht-op-login");
  let el = document.getElementById("verbindingsfout");
  if (!el) {
    el = document.createElement("div");
    el.id = "verbindingsfout";
    el.className = "verbindingsfout";
    document.body.appendChild(el);
  }
  el.textContent = "Geen verbinding met de database. Controleer je internet en probeer het opnieuw. ";
  const knop = document.createElement("button");
  knop.type = "button";
  knop.textContent = "Opnieuw";
  knop.onclick = () => location.reload();
  el.appendChild(knop);
  if (bericht) console.warn("Databasefout:", bericht);
}

/* ---- kleine hulpfuncties voor alle pagina's ---- */

/* Tekst veilig in HTML zetten. Gebruik dit voor ALLES wat uit de database komt. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Naam om te tonen: de naam uit het account, anders het e-mailadres. */
function naamVan(naam, username) { return (naam && naam.trim()) || username || ""; }

/* "2026-10-03" → "3 okt 2026". Leeg of ongeldig → "". */
function fmtDatum(d) {
  if (!d) return "";
  const dt = new Date(String(d).length === 10 ? d + "T12:00:00" : d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

/* ISO-tijdstip → "3 okt, 14:05". */
function fmtMoment(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + ", " +
    dt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/* 1234.5 of "1234,5" → "€ 1.234,50". Leeg → "". */
function fmtEuro(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(",", "."));
  if (isNaN(n)) return String(v);
  return "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
