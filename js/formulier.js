/* ==========================================================================
   Formulierpagina (formulier.html): invullen in vier stappen, opslaan, indienen.

   Laadvolgorde: supabase-js, config.js, gegevens.js, sessie.js, dit bestand.

   Sinds 2026-10-21 een stappenformulier (model: Bremer-offertemodule) met veel minder
   velden. Vestiging komt uit het account, polis, financiering en IVN zijn eruit.

   De mail aan de administratie is letterlijk de tabel die de Excel-macro maakte
   (Afleverformulier ADG VEENDAM.xlsm): dezelfde 44 regels, dezelfde teksten, dezelfde
   volgorde, met daaronder de naam van de verkoper. De administratie werkt op dat
   formaat, dus verander mailRijen() en buildMailHtml() niet zonder overleg.

   Versturen: een webpagina kan Outlook niet zelf vullen. Indienen downloadt daarom een
   .eml-bestand met "X-Unsent: 1"; Outlook opent dat als nieuwe mail die de verkoper
   alleen nog verstuurt. Terugval: de tabel naar het klembord en een lege mail openen.
   ========================================================================== */

/* ---------- toestand ---------- */
const STAPPEN = 4;
const MAIL_ONDERWERP = "Afleverformulier";   // zoals de Excel-macro, niet aanpassen
let stap = 1;
let mij = null;                 // het ingelogde account
let verkoperNaam = "";          // eigenaar van het formulier, komt onder de tabel in de mail
let huidigId = "";              // formuliernummer, leeg zolang het formulier nieuw is
let huidigeStatus = "concept";  // concept of ingediend
let laatsteOpslag = null;       // JSON van de velden bij het laatste opslaan of laden
let alleenLezen = false;
let bezig = false;              // een opslag loopt
let sluitZonderVraag = false;   // na bevestiging: geen beforeunload-melding meer
let voetBasis = "";             // tekst in de voet als er niets openstaat, bijv. "Opgeslagen om 14:05"
let premies = [];               // [{ soort, bedrag, code }]

const $ = id => document.getElementById(id);

function val(id){
  const el = document.getElementById(id);
  return el ? (el.value || "").trim() : "";
}
function toon(id, aan){ $(id).classList.toggle("hidden", !aan); }

/* ---------- bedragen, datum, kilometers ---------- */
/* Neemt "2100", "2.100", "2100,50", "2.100,50" en "2100.50" aan. Leeg → null, onzin → NaN. */
function parseBedrag(s){
  let t = String(s == null ? "" : s).replace(/[€\s]/g, "");
  if(!t) return null;
  if(t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if(/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if(!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100) / 100;
}
function bedragGeldig(n){ return n !== null && !isNaN(n); }
function bedragKaal(n){ return n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function euroTekst(n){ return bedragGeldig(n) ? "€ " + bedragKaal(n) : ""; }
function bedragNetjes(el){
  const n = parseBedrag(el.value);
  if(bedragGeldig(n)) el.value = bedragKaal(n);
}

/* "2026-10-21" → "21-10-2026", zoals Excel de datum in de mail zette. */
function datumNL(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function kmWaarde(){ return val("km_stand").replace(/[.\s]/g, ""); }

/* Werkdagen (ma t/m vr) van morgen tot en met de afleverdag. Feestdagen tellen mee. */
function werkdagenTot(iso){
  const doel = new Date(iso + "T12:00:00");
  if(isNaN(doel)) return null;
  const d = new Date(); d.setHours(12, 0, 0, 0);
  if(doel < d) return -1;
  let n = 0;
  while(d < doel){
    d.setDate(d.getDate() + 1);
    if(d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
}

function werkWerkdagenBij(){
  const box = $("melding_werkdagen");
  const n = val("afleverdatum") ? werkdagenTot(val("afleverdatum")) : null;
  if(n === null || n >= 6 || huidigeStatus === "ingediend"){ box.classList.add("hidden"); return; }
  box.textContent = n < 0
    ? "Deze afleverdatum ligt in het verleden."
    : `De aflevering is over ${n} ${n === 1 ? "werkdag" : "werkdagen"}. De administratie vraagt het formulier minimaal 6 werkdagen van tevoren.`;
  box.classList.remove("hidden");
}

/* ---------- keuzeknoppen (nieuw/gebruikt, inruil, zelf houden/handel) ---------- */
function zetKeuze(veld, waarde){
  $(veld).value = waarde || "";
  document.querySelectorAll(`.keuzes[data-veld="${veld}"] button`).forEach(b => {
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", b.dataset.waarde === waarde ? "true" : "false");
  });
}

/* Wat zichtbaar is volgt uit de keuzes. Wat verdwijnt wordt leeggemaakt, zodat er nooit
   een verborgen waarde in de mail belandt. */
function pasZichtbaarheidAan(){
  const soort = val("soort_voertuig");
  const inruil = val("inruil");

  toon("blok_inruil", !!soort);

  const bestemmingNodig = soort === "Nieuw" && inruil === "Ja";
  toon("blok_bestemming", bestemmingNodig);
  if(!bestemmingNodig) zetKeuze("inruil_bestemming", "");

  const boekwaardeNodig = inruil === "Ja" &&
    (soort === "Occasion" || (soort === "Nieuw" && val("inruil_bestemming") === "Handel"));
  toon("blok_boekwaarde", boekwaardeNodig);
  if(!boekwaardeNodig) $("boekwaarde").value = "";

  toon("blok_premies", soort === "Nieuw");
  if(soort !== "Nieuw" && premies.some(heeftInhoud)){
    premies = [];
    renderPremies();
  }
  syncPremies();
}

/* ---------- premies ---------- */
/* Soort, en waar in de Excel-tabel het bedrag en de code komen. AP-code hoort in Excel bij
   fleetondersteuning, het DROPP-ticket bij aanvullende toezeggingen. */
const PREMIE_SOORTEN = [
  { waarde: "Inruilpremie", code: "" },
  { waarde: "Retailpremie", code: "" },
  { waarde: "AP-code", code: "AP-code" },
  { waarde: "DROPP-ticket", code: "DROPP-ticketnummer" }
];
function codeLabel(soort){
  const s = PREMIE_SOORTEN.find(x => x.waarde === soort);
  return s ? s.code : "";
}
function heeftInhoud(p){ return !!(p.soort || p.bedrag || p.code); }
function syncPremies(){
  $("premies").value = premies.some(heeftInhoud) ? JSON.stringify(premies.filter(heeftInhoud)) : "";
}

function renderPremies(){
  if(!premies.length) premies = [{ soort: "", bedrag: "", code: "" }];
  const box = $("premieRijen");
  box.textContent = "";

  premies.forEach((p, i) => {
    const rij = document.createElement("div");
    rij.className = "premie";

    const sel = document.createElement("select");
    sel.id = "premie_soort_" + i;
    sel.setAttribute("aria-label", "Soort premie");
    sel.add(new Option("Soort premie", ""));
    PREMIE_SOORTEN.forEach(s => {
      const o = new Option(s.waarde, s.waarde);
      o.disabled = s.waarde !== p.soort && premies.some((q, j) => j !== i && q.soort === s.waarde);
      sel.add(o);
    });
    sel.value = p.soort || "";
    sel.addEventListener("change", () => {
      p.soort = sel.value;
      if(!codeLabel(p.soort)) p.code = "";
      syncPremies();
      renderPremies();
      werkBij();
      const volgend = $(codeLabel(p.soort) && !p.code ? "premie_code_" + i : "premie_bedrag_" + i);
      if(volgend && !p.bedrag) volgend.focus();
    });

    const wrap = document.createElement("div");
    wrap.className = "bedrag premie-bedrag";
    const euro = document.createElement("span");
    euro.textContent = "€";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.inputMode = "decimal";
    inp.id = "premie_bedrag_" + i;
    inp.placeholder = "0,00";
    inp.setAttribute("aria-label", "Bedrag importeursdeel, incl. btw");
    inp.value = p.bedrag || "";
    inp.addEventListener("input", () => { p.bedrag = inp.value; syncPremies(); werkBij(); });
    inp.addEventListener("blur", () => { bedragNetjes(inp); p.bedrag = inp.value; syncPremies(); werkBij(); });
    wrap.append(euro, inp);

    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "premie-weg";
    weg.textContent = "×";
    weg.setAttribute("aria-label", "Premie weghalen");
    weg.addEventListener("click", () => {
      premies.splice(i, 1);
      syncPremies();
      renderPremies();
      werkBij();
    });

    rij.append(sel, wrap, weg);

    const label = codeLabel(p.soort);
    if(label){
      const code = document.createElement("input");
      code.type = "text";
      code.className = "code";
      code.id = "premie_code_" + i;
      code.placeholder = label;
      code.setAttribute("aria-label", label);
      code.value = p.code || "";
      code.addEventListener("input", () => { p.code = code.value; syncPremies(); werkBij(); });
      rij.appendChild(code);
    }

    if(alleenLezen) rij.querySelectorAll("select,input,button").forEach(el => { el.disabled = true; });
    box.appendChild(rij);
  });

  $("knopPremieErbij").disabled = alleenLezen || premies.length >= PREMIE_SOORTEN.length;
}

/* Per soort het bedrag en de code, voor de mail. */
function premieWaarden(){
  const bedrag = {}, code = {};
  premies.forEach(p => {
    if(!p.soort) return;
    bedrag[p.soort] = parseBedrag(p.bedrag);
    code[p.soort] = (p.code || "").trim();
  });
  return { bedrag, code };
}

/* ---------- verkoopleider en controle ---------- */
function getManagerEmail(){
  return verkoopleiderVoor(val("vestiging"), val("soort_voertuig"));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Alles wat ontbreekt of niet klopt, per stap. veld = id van het veld om te markeren. */
function checkRules(){
  const uit = [];
  const voeg = (s, veld, tekst) => uit.push({ stap: s, veld, tekst });

  if(!val("vestiging")) voeg(1, "vestiging", "Vestiging ontbreekt");
  if(!val("ordernummer")) voeg(1, "ordernummer", "Ordernummer ontbreekt");
  else if(!/^\d+$/.test(val("ordernummer"))) voeg(1, "ordernummer", "Ordernummer mag alleen cijfers bevatten");
  if(!val("klantnaam")) voeg(1, "klantnaam", "Klantnaam ontbreekt");
  if(!val("afleverdatum")) voeg(1, "afleverdatum", "Afleverdatum ontbreekt");
  if(!kmWaarde()) voeg(1, "km_stand", "Kilometerstand ontbreekt");
  else if(!/^\d+$/.test(kmWaarde())) voeg(1, "km_stand", "Kilometerstand mag alleen cijfers bevatten");

  if(!val("email_factuur")) voeg(2, "email_factuur", "E-mailadres voor de factuur ontbreekt");
  else if(!EMAIL_RE.test(val("email_factuur"))) voeg(2, "email_factuur", "E-mailadres voor de factuur klopt niet");
  if(!val("email_pech")) voeg(2, "email_pech", "E-mailadres voor de pechhulppas ontbreekt");
  else if(!EMAIL_RE.test(val("email_pech"))) voeg(2, "email_pech", "E-mailadres voor de pechhulppas klopt niet");

  const soort = val("soort_voertuig");
  if(!soort) voeg(3, "soort_voertuig", "Kies nieuw of gebruikt");
  else if(!val("inruil")) voeg(3, "inruil", "Kies of er een inruil is");
  if(!$("blok_bestemming").classList.contains("hidden") && !val("inruil_bestemming")){
    voeg(3, "inruil_bestemming", "Kies of je de inruil zelf houdt of naar de handel gaat");
  }
  if(!$("blok_boekwaarde").classList.contains("hidden")){
    const bw = parseBedrag(val("boekwaarde"));
    if(bw === null) voeg(3, "boekwaarde", "Boekwaarde ontbreekt");
    else if(isNaN(bw)) voeg(3, "boekwaarde", "Boekwaarde is geen geldig bedrag");
  }
  if(soort === "Nieuw"){
    premies.forEach((p, i) => {
      if(!heeftInhoud(p)) return;
      const naam = p.soort || "premie";
      if(!p.soort) voeg(3, "premie_soort_" + i, "Kies het soort premie bij " + (p.bedrag ? "€ " + p.bedrag : "de premie"));
      const n = parseBedrag(p.bedrag);
      if(n === null) voeg(3, "premie_bedrag_" + i, "Bedrag ontbreekt bij " + naam);
      else if(isNaN(n)) voeg(3, "premie_bedrag_" + i, "Bedrag bij " + naam + " is geen geldig bedrag");
      if(codeLabel(p.soort) && !(p.code || "").trim()) voeg(3, "premie_code_" + i, codeLabel(p.soort) + " ontbreekt");
      if(p.soort === "Inruilpremie" && val("inruil") !== "Ja") voeg(3, "premie_soort_" + i, "Inruilpremie ingevuld, maar er is geen inruil");
    });
  }

  const bt = parseBedrag(val("toe_te_betalen"));
  if(bt === null) voeg(4, "toe_te_betalen", "Eindbedrag ontbreekt");
  else if(isNaN(bt)) voeg(4, "toe_te_betalen", "Eindbedrag is geen geldig bedrag");

  return uit;
}

/* ---------- de mail: de Excel-tabel, regel voor regel ---------- */
/* Kolom A en B van het werkblad "Afleverformulier", rij 1 tot en met 44. Lege rijen horen
   erbij: de macro nam het hele gebruikte bereik mee, ook de witregels. */
function mailRijen(){
  const pw = premieWaarden();
  const bw = parseBedrag(val("boekwaarde"));
  return [
    ["Afleverformulier", ""],
    ["Minimaal 6 werkdagen vóór aflevering indienen bij V.A.", ""],
    ["", ""],
    ["Ordernummer", val("ordernummer")],
    ["", ""],
    ["Klantnaam", val("klantnaam")],
    ["", ""],
    ["Afleverdatum", datumNL(val("afleverdatum"))],
    ["", ""],
    ["Actuele km-stand", kmWaarde()],
    ["", ""],
    ["VAN IMPORTEUR TE ONTVANGEN BEDRAGEN:", ""],
    ["Inruilpremie excl. dealerbijdrage (incl. BTW)", euroTekst(pw.bedrag["Inruilpremie"])],
    ["Retailpremie (incl. BTW)", euroTekst(pw.bedrag["Retailpremie"])],
    ["Voorraadpremie (incl. BTW)", ""],
    ["Strijdfonds (incl. BTW)", ""],
    ["Fleetondersteuning (incl. BTW)", euroTekst(pw.bedrag["AP-code"])],
    ["              - AP-code:", pw.code["AP-code"] || ""],
    ["Aanvullende toezeggingen (incl. BTW)", euroTekst(pw.bedrag["DROPP-ticket"])],
    ["              - DROPP-ticket:", pw.code["DROPP-ticket"] || ""],
    ["", ""],
    ["Boekwaarde inruiler (bij gebruikt of via CC) incl. BTW", euroTekst(bedragGeldig(bw) ? bw : 0)],
    ["", ""],
    ["Gegevens inruiler ingevuld", val("inruil") === "Nee" ? "N.V.T." : ""],
    ["", ""],
    ["Toe te betalen bedrag incl. BTW", euroTekst(parseBedrag(val("toe_te_betalen")))],
    ["", ""],
    ["Aanbetaling financiering / PL indien van toepassing", ""],
    ["", ""],
    ["Aantal km per jaar", ""],
    ["", ""],
    ["NAWTE-gegevens gecontroleerd", ""],
    ["", ""],
    ["Klant overdragen", ""],
    ["", ""],
    ["Centraal Bestelorder", ""],
    ["", ""],
    ["E-mailadres tbv factuur", val("email_factuur")],
    ["", ""],
    ["E-mailadres tbv mobiliteitspas", val("email_pech")],
    ["", ""],
    ["Onderstaande in te vullen door Centrale Administratie", ""],
    ["", ""],
    ["Kenteken", ""]
  ];
}

/* Dezelfde HTML als de macro: <table border=1>, drie kolommen (A tot en met C, de derde
   altijd leeg), afgesloten met twee lege alinea's. Daaronder de verkoper, omdat de mail
   straks niet altijd vanaf het adres van de verkoper zelf komt.
   Eén afwijking: de macro schreef bgcolor=#FFFFF0# (hekje te veel). Outlook toont dat als
   gebroken wit, browsers en andere mailprogramma's als knalgeel. Hier staat de bedoelde
   kleur #FFFFF0, zodat de tabel er overal uitziet als in Outlook. */
/* Op verzoek van Jasper (2026-10-21) beter leesbaar gemaakt: enkele lijnen, ruimte in de
   cellen, ingevulde waarden vet, kopregels vet op een iets donkerder vlak. Rijen, teksten en
   volgorde zijn ongewijzigd; de lege derde kolom van de macro is weggelaten. Alles staat
   inline, omdat Outlook geen stylesheet leest. */
const MAIL_RAND = "border:1px solid #b5b5a8;";
const MAIL_CEL = "padding:5px 9px;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;" + MAIL_RAND;

function buildMailHtml(){
  let c = '<table border=1 cellspacing=0 cellpadding=5 bgcolor=#FFFFF0 style="border-collapse:collapse;' + MAIL_RAND + '">';
  mailRijen().forEach(([a, b]) => {
    if(!a){
      c += '<tr><td colspan=2 style="height:6px;padding:0;font-size:4pt;line-height:4pt;' + MAIL_RAND + '">&nbsp;</td></tr>';
      return;
    }
    const kop = KOP_RIJEN.includes(a);
    c += "<tr>" +
      '<td width=380 style="' + MAIL_CEL + (kop ? "font-weight:bold;background:#EFEFD9;" : "") + '">' + esc(a) + "</td>" +
      '<td width=200 style="' + MAIL_CEL + (kop ? "background:#EFEFD9;" : "font-weight:bold;") + '">' + esc(b) + "</td>" +
      "</tr>";
  });
  c += "</table><P></P>";
  c += '<P style="font-family:Calibri,Arial,sans-serif;font-size:11pt">Verkoper: <b>' + esc(verkoperNaam) + "</b></P>";
  return c;
}

/* Platte tekst van dezelfde inhoud, voor het klembord naast de HTML. */
function buildMailText(){
  return mailRijen().map(([a, b]) => (a + (b ? "\t" + b : "")).trim()).join("\n") +
    "\n\nVerkoper: " + verkoperNaam;
}

function base64Utf8(tekst){
  const bytes = new TextEncoder().encode(tekst);
  let bin = "";
  for(let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, "$&\r\n");
}

/* Een conceptmail als .eml. X-Unsent: 1 laat Outlook hem openen als nieuwe, nog niet
   verstuurde mail met Verzenden-knop. */
function bouwEml(){
  const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>' +
    buildMailHtml() + "</body></html>";
  return [
    "To: " + ADMINISTRATIE_MAIL,
    "Cc: " + getManagerEmail(),
    "Subject: " + MAIL_ONDERWERP,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(html)
  ].join("\r\n");
}

function mailBestandsnaam(){ return "Afleverformulier " + val("ordernummer") + ".eml"; }

/* Download en mailto in losse functies, zodat een test ze kan vervangen en de inhoud kan
   vangen zonder dat er echt een bestand of mailprogramma opent. */
function downloadMail(bestandsnaam, inhoud){
  const url = URL.createObjectURL(new Blob([inhoud], { type: "message/rfc822" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = bestandsnaam;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function openMail(url){
  location.href = url;
}

function maakMail(){
  downloadMail(mailBestandsnaam(), bouwEml());
  $("klaarBestand").textContent = mailBestandsnaam();
  $("kopieerHint").textContent = "";
  toon("blok_klaar", true);
  $("blok_klaar").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function kopieerTabel(){
  const hint = $("kopieerHint");
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([buildMailHtml()], { type: "text/html" }),
      "text/plain": new Blob([buildMailText()], { type: "text/plain" })
    })]);
  } catch(e) {
    hint.textContent = "Kopiëren lukte niet in deze browser. Gebruik het mailbestand.";
    return;
  }
  hint.textContent = "De tabel staat op je klembord. Er opent nu een lege mail: klik in de tekst en plak met Ctrl+V.";
  openMail(`mailto:${ADMINISTRATIE_MAIL}?cc=${encodeURIComponent(getManagerEmail())}&subject=${encodeURIComponent(MAIL_ONDERWERP)}`);
}

/* ---------- stap 4: wat de administratie krijgt ---------- */
const KOP_RIJEN = ["Afleverformulier", "VAN IMPORTEUR TE ONTVANGEN BEDRAGEN:", "Onderstaande in te vullen door Centrale Administratie"];

function renderControle(){
  const cc = getManagerEmail();
  $("mailAan").textContent = "Aan " + ADMINISTRATIE_MAIL + (cc ? ", cc " + cc : ", nog geen verkoopleider in cc: kies eerst de vestiging") +
    ". Onderwerp: " + MAIL_ONDERWERP + ".";

  const box = $("controleLijst");
  box.textContent = "";
  const rijen = mailRijen().filter(([a]) => a).concat([["Verkoper", verkoperNaam]]);
  rijen.forEach(([a, b]) => {
    const rij = document.createElement("dl");
    rij.className = "controle-rij" + (KOP_RIJEN.includes(a) ? " kop-rij" : "") +
      (a === "Toe te betalen bedrag incl. BTW" ? " totaal" : "");
    const dt = document.createElement("dt");
    dt.textContent = a.trim();
    const dd = document.createElement("dd");
    dd.textContent = b;
    rij.append(dt, dd);
    box.appendChild(rij);
  });
}

/* ---------- stappen ---------- */
function stapTitel(n){ return document.querySelector(`.stap[data-stap="${n}"]`).dataset.titel; }

function ga(n){
  stap = Math.min(Math.max(n, 1), STAPPEN);
  document.querySelectorAll(".stap").forEach(s => s.classList.toggle("hidden", Number(s.dataset.stap) !== stap));
  $("stapTeller").textContent = `Stap ${stap} van ${STAPPEN}`;
  $("stapTitel").textContent = stapTitel(stap);
  werkStappenBij();
  if(stap === STAPPEN) renderControle();
  werkVoetKnoppenBij();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function werkStappenBij(){
  const open = checkRules();
  document.querySelectorAll("#stappen button").forEach(b => {
    const n = Number(b.dataset.naar);
    b.classList.toggle("aan", n === stap);
    b.classList.toggle("klaar", n !== stap && !open.some(i => i.stap === n));
    if(n === stap) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
  });
}

function werkVoetKnoppenBij(){
  $("knopVorige").classList.toggle("hidden", stap === 1);
  const knop = $("knopVolgende");
  if(stap < STAPPEN){
    knop.textContent = "Volgende: " + stapTitel(stap + 1).toLowerCase();
    knop.classList.remove("hidden");
  } else {
    knop.textContent = huidigeStatus === "ingediend" ? "Opnieuw indienen" : "Indienen";
    knop.classList.toggle("hidden", alleenLezen);
  }
}

function volgende(){
  if(stap === STAPPEN){ indienen(); return; }
  if(!alleenLezen){
    const open = checkRules().filter(i => i.stap === stap);
    if(open.length){ toonRegels(open); return; }
  }
  wisRegelMelding();
  ga(stap + 1);
}

function vorige(){
  wisRegelMelding();
  ga(stap - 1);
}

/* ---------- meldingen en markeringen ---------- */
function markeer(veld){
  const el = $(veld);
  if(!el) return;
  if(el.type === "hidden"){
    const groep = document.querySelector(`.keuzes[data-veld="${veld}"]`);
    if(groep) groep.classList.add("veld-mist");
  } else {
    el.classList.add("veld-mist");
  }
}

function wisMarkeringen(){
  document.querySelectorAll(".veld-mist").forEach(el => el.classList.remove("veld-mist"));
}

function wisRegelMelding(){
  $("melding_regels").classList.add("hidden");
  wisMarkeringen();
}

function toonRegels(issues){
  wisMarkeringen();
  const box = $("melding_regels");
  box.textContent = "";
  const kop = document.createElement("strong");
  kop.textContent = issues.some(i => i.stap !== stap) ? "Het formulier is nog niet compleet:" : "Nog niet compleet:";
  const lijst = document.createElement("ul");
  issues.forEach(i => {
    const li = document.createElement("li");
    li.textContent = i.tekst + (i.stap !== stap ? " (stap " + i.stap + ")" : "");
    lijst.appendChild(li);
    /* ontbreekt de vestiging, dan moet het keuzeveld er staan, wat het account ook zegt */
    if(i.veld === "vestiging") toon("blok_vestiging", true);
    markeer(i.veld);
  });
  box.append(kop, lijst);
  box.classList.remove("hidden", "schud");
  void box.offsetWidth;
  box.classList.add("schud");
  const rustig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: rustig ? "auto" : "smooth" });
  box.focus({ preventScroll: true });
}

/* ---------- velden verzamelen en invullen ---------- */
/* De velden van het formulier zelf; de losse premievelden vallen erbuiten, die staan
   samen als JSON in het verborgen veld "premies". */
function formulierVelden(){
  return Array.from(document.querySelectorAll("#adgForm input, #adgForm select"))
    .filter(el => el.id && !el.closest("#premieRijen"));
}

function verzamel(){
  const o = {};
  formulierVelden().forEach(el => { o[el.id] = el.value; });
  return o;
}

/* Eerst alle waarden, dan keuzeknoppen, premies en zichtbaarheid laten kloppen. Velden uit
   het oude formulier (polis, financiering, IVN) worden genegeerd en verdwijnen bij de
   volgende opslag. */
function vul(data){
  formulierVelden().forEach(el => {
    if(data && Object.prototype.hasOwnProperty.call(data, el.id)){
      const v = data[el.id];
      el.value = (v === null || v === undefined) ? "" : String(v);
    }
  });
  ["soort_voertuig", "inruil", "inruil_bestemming"].forEach(k => zetKeuze(k, val(k)));
  try { premies = data && data.premies ? JSON.parse(data.premies) : []; } catch(e) { premies = []; }
  if(!Array.isArray(premies)) premies = [];
  ["boekwaarde", "toe_te_betalen"].forEach(id => bedragNetjes($(id)));
  premies.forEach(p => { const n = parseBedrag(p.bedrag); if(bedragGeldig(n)) p.bedrag = bedragKaal(n); });
  const pech = val("email_pech"), fact = val("email_factuur");
  $("email_pech_los").value = pech && pech !== fact ? "1" : "";
  renderPremies();
  pasZichtbaarheidAan();
  werkPechHintBij();
}

/* ---------- e-mailadressen: één keer typen, twee velden ---------- */
function werkPechHintBij(){
  $("email_pech_hint").textContent = val("email_pech_los") === "1"
    ? "Apart adres voor de pechhulppas. Maak het veld leeg om weer het factuuradres te gebruiken."
    : "Neemt het adres van de factuur over. Pas het alleen aan als de pechhulppas naar een ander adres moet.";
}

/* ---------- niet-opgeslagen wijzigingen ---------- */
function isDirty(){
  return laatsteOpslag !== null && !alleenLezen && JSON.stringify(verzamel()) !== laatsteOpslag;
}

window.addEventListener("beforeunload", e => {
  if(!sluitZonderVraag && isDirty()){
    e.preventDefault();
    e.returnValue = "";
  }
});

function terugNaarStart(){
  if(isDirty() && !confirm("Je hebt wijzigingen die nog niet zijn opgeslagen. Toch terug naar start?")) return;
  sluitZonderVraag = true;
  location.href = "start.html";
}

/* ---------- voet: status ---------- */
function setVoet(tekst, soort){
  const el = $("voetStatus");
  el.textContent = tekst || "";
  el.className = "voet-status" + (soort === "fout" ? " fout-tekst" : soort === "ok" ? " ok-tekst" : "");
}

function werkVoetBij(){
  if(laatsteOpslag === null || alleenLezen || bezig) return;
  if(isDirty()) setVoet("Nog niet opgeslagen", "");
  else setVoet(voetBasis, voetBasis ? "ok" : "");
}

/* Na elke wijziging: voet, stappenbalk en zo nodig het controleoverzicht. */
function werkBij(){
  werkVoetBij();
  werkStappenBij();
  if(stap === STAPPEN) renderControle();
}

function nu(){
  return new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function werkSubregelBij(){
  const el = $("subregel");
  el.textContent = "";
  if(!huidigId){
    el.textContent = "Nieuw formulier, nog niet opgeslagen";
    $("p_nummer").textContent = "nog niet opgeslagen";
    return;
  }
  const nr = document.createElement("span");
  nr.textContent = "Formulier " + huidigId;
  const badge = document.createElement("span");
  badge.className = "badge " + huidigeStatus;
  badge.textContent = huidigeStatus === "ingediend" ? "Ingediend" : "Concept";
  el.append(nr, badge);
  $("p_nummer").textContent = huidigId;
  werkVoetKnoppenBij();
}

function zetBusy(aan, knop){
  ["knopOpslaan", "knopVolgende", "knopVorige"].forEach(id => { $(id).disabled = aan; });
  if(knop) knop.classList.toggle("btn-busy", aan);
}

/* ---------- opslaan ---------- */
async function slaOp(indienen, knop){
  if(bezig) return false;
  bezig = true;
  zetBusy(true, knop);
  setVoet("", "");
  syncPremies();
  const data = verzamel();
  try {
    const res = await rpcMetSessie("formulier_opslaan", {
      p_id: huidigId || null, p_data: data, p_indienen: !!indienen
    });
    if(res.error){
      setVoet(res.error.message || "Opslaan is niet gelukt", "fout");
      return false;
    }
    let nr = res.data;
    if(Array.isArray(nr)) nr = nr[0];
    if(nr && typeof nr === "object") nr = Object.values(nr)[0];
    nr = nr ? String(nr) : "";
    if(!nr){
      setVoet("Opslaan is niet gelukt, er kwam geen formuliernummer terug", "fout");
      return false;
    }
    huidigId = nr;
    if(indienen) huidigeStatus = "ingediend";
    laatsteOpslag = JSON.stringify(data);
    history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(nr));
    voetBasis = (indienen ? "Ingediend om " : "Opgeslagen om ") + nu();
    werkSubregelBij();
    return true;
  } finally {
    bezig = false;
    zetBusy(false, knop);
  }
}

async function opslaan(){
  if(alleenLezen) return;
  if(await slaOp(false, $("knopOpslaan"))) werkVoetBij();
}

/* ---------- indienen: eerst controleren, dan opslaan, dan de mail ---------- */
async function indienen(){
  if(alleenLezen || bezig) return;

  const issues = checkRules();
  if(issues.length){
    if(issues[0].stap !== stap) ga(issues[0].stap);
    toonRegels(issues);
    return;
  }
  if(!getManagerEmail()){
    toon("blok_vestiging", true);
    ga(1);
    toonRegels([{ stap: 1, veld: "vestiging", tekst: "Er kon geen verkoopleider worden bepaald. Kies de vestiging." }]);
    return;
  }
  wisRegelMelding();

  if(!await slaOp(true, $("knopVolgende"))) return;
  setVoet(voetBasis, "ok");
  maakMail();
}

/* ---------- printen ---------- */
function printDocument(){
  const tabel = document.createElement("table");
  tabel.className = "print-tabel";
  mailRijen().forEach(([a, b]) => {
    const tr = tabel.insertRow();
    if(!a) tr.className = "leeg";
    tr.insertCell().textContent = a;
    tr.insertCell().textContent = b;
  });
  const voet = document.createElement("p");
  voet.className = "print-voet";
  voet.textContent = "Verkoper: " + verkoperNaam;
  $("printTabel").replaceChildren(tabel, voet);
  window.print();
}

/* ---------- alleen lezen ---------- */
function zetAlleenLezen(naamEigenaar){
  alleenLezen = true;
  formulierVelden().forEach(el => { el.disabled = true; });
  document.querySelectorAll(".keuzes button").forEach(b => { b.disabled = true; });
  renderPremies();
  $("knopOpslaan").classList.add("hidden");
  const m = $("melding_eigenaar");
  m.textContent = "Dit formulier is van " + naamEigenaar + ". Je kunt het bekijken en printen, niet aanpassen.";
  m.classList.remove("hidden");
  werkVoetKnoppenBij();
}

/* ---------- niet gevonden of niet te laden ---------- */
function toonNietGevonden(tekst, opnieuw){
  $("app").classList.add("hidden");
  $("nietGevondenTekst").textContent = tekst;
  $("nietGevondenOpnieuw").classList.toggle("hidden", !opnieuw);
  $("nietGevonden").classList.remove("hidden");
}

/* ---------- formulier laden ---------- */
async function laadFormulier(id){
  const res = await rpcMetSessie("formulier_get", { p_id: id });
  if(res.error){
    toonNietGevonden("Formulier " + id + " kon niet worden geladen: " + (res.error.message || "onbekende fout"), true);
    return false;
  }
  const rij = Array.isArray(res.data) ? res.data[0] : res.data;
  if(!rij){
    toonNietGevonden("Formulier " + id + " is niet gevonden", false);
    return false;
  }

  huidigId = String(rij.id || id);
  huidigeStatus = rij.status === "ingediend" ? "ingediend" : "concept";
  verkoperNaam = naamVan(rij.verkoper_naam, rij.verkoper);

  vul(rij.data || {});
  /* een eigen formulier zonder vestiging krijgt die van het account */
  if(!val("vestiging") && rij.verkoper === mij.username && mij.vestiging) $("vestiging").value = mij.vestiging;
  werkSubregelBij();
  laatsteOpslag = JSON.stringify(verzamel());

  if(rij.mag_bewerken === false){
    zetAlleenLezen(verkoperNaam);
  }
  return true;
}

/* ---------- opstarten ---------- */
function koppelGebeurtenissen(){
  $("adgForm").addEventListener("submit", e => e.preventDefault());

  document.querySelectorAll(".keuzes").forEach(groep => {
    groep.addEventListener("click", e => {
      const b = e.target.closest("button");
      if(!b || b.disabled) return;
      zetKeuze(groep.dataset.veld, b.dataset.waarde);
      groep.classList.remove("veld-mist");
      pasZichtbaarheidAan();
      werkBij();
    });
  });

  $("email_factuur").addEventListener("input", () => {
    if(val("email_pech_los") !== "1") $("email_pech").value = $("email_factuur").value;
  });
  $("email_pech").addEventListener("input", () => {
    const p = val("email_pech");
    $("email_pech_los").value = p && p !== val("email_factuur") ? "1" : "";
    werkPechHintBij();
  });

  ["boekwaarde", "toe_te_betalen"].forEach(id => $(id).addEventListener("blur", () => { bedragNetjes($(id)); werkBij(); }));
  $("afleverdatum").addEventListener("change", werkWerkdagenBij);

  /* een gecorrigeerd veld verliest zijn rode rand; Enter gaat naar de volgende stap */
  $("adgForm").addEventListener("input", e => { e.target.classList.remove("veld-mist"); werkBij(); });
  $("adgForm").addEventListener("change", e => { e.target.classList.remove("veld-mist"); werkBij(); });
  $("adgForm").addEventListener("keydown", e => {
    if(e.key === "Enter" && e.target.tagName === "INPUT"){
      e.preventDefault();
      volgende();
    }
  });

  $("knopPremieErbij").addEventListener("click", () => {
    premies.push({ soort: "", bedrag: "", code: "" });
    renderPremies();
    $("premie_soort_" + (premies.length - 1)).focus();
  });

  document.querySelectorAll("#stappen button").forEach(b =>
    b.addEventListener("click", () => { wisRegelMelding(); ga(Number(b.dataset.naar)); }));

  $("terugKnop").addEventListener("click", terugNaarStart);
  $("knopOpslaan").addEventListener("click", opslaan);
  $("knopVolgende").addEventListener("click", volgende);
  $("knopVorige").addEventListener("click", vorige);
  $("knopPrint").addEventListener("click", printDocument);
  $("knopOpnieuwDownload").addEventListener("click", () => downloadMail(mailBestandsnaam(), bouwEml()));
  $("knopKopieer").addEventListener("click", kopieerTabel);
}

VESTIGINGEN.forEach(v => $("vestiging").add(new Option(v, v)));
koppelGebeurtenissen();
renderPremies();
pasZichtbaarheidAan();
ga(1);

(async function start(){
  const ik = await vereisLogin();
  if(!ik) return;
  mij = ik;
  verkoperNaam = naamVan(ik.naam, ik.username);

  const id = (new URLSearchParams(location.search).get("id") || "").trim();
  if(id){
    if(!await laadFormulier(id)) return;
  } else {
    $("vestiging").value = ik.vestiging || "";
    laatsteOpslag = JSON.stringify(verzamel());
  }
  /* de vestiging vragen alleen als het account er geen heeft, of als dit formulier een
     andere heeft dan het account (bijvoorbeeld van een collega) */
  toon("blok_vestiging", !(ik.vestiging && val("vestiging") === ik.vestiging));
  werkWerkdagenBij();
  werkPechHintBij();
  ga(1);
})();
