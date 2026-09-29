/* ==========================================================================
   Formulierpagina (formulier.html): invullen, opslaan, indienen en printen.

   Laadvolgorde: supabase-js, config.js, gegevens.js, sessie.js, dit bestand.

   Wat uit het oorspronkelijke formulier ongewijzigd is overgenomen: de regels rond
   nieuw/occasion, inruil en premies, checkRules(), buildMailText() (behalve de regel
   Formuliernummer bovenaan), syncPrintData() en het onderwerp van de mail. De
   administratie is die opmaak gewend, dus daar blijf je van af.

   Nieuw: opslaan en laden via de databasefuncties formulier_get en formulier_opslaan,
   alleen-lezen bij andermans formulier, meldingen op de pagina in plaats van alert(),
   en een waarschuwing bij niet-opgeslagen wijzigingen.
   ========================================================================== */

/* ---------- toestand ---------- */
let currentField = "";
let huidigId = "";              // formuliernummer, leeg zolang het formulier nieuw is
let huidigeStatus = "concept";  // concept of ingediend
let laatsteOpslag = null;       // JSON van de velden bij het laatste opslaan of laden
let alleenLezen = false;
let bezig = false;              // een opslag loopt
let sluitZonderVraag = false;   // na bevestiging: geen beforeunload-melding meer
let voetBasis = "";             // tekst in de voet als er niets openstaat, bijv. "Opgeslagen om 14:05"

const $ = id => document.getElementById(id);

/* ---------- venster voor reden en toelichting ---------- */
const modalConfigs = {
  polis_besproken: {
    title: "Waarom is polis niet besproken?",
    intro: "Deze toelichting wordt opgeslagen bij polis.",
    options: ["Geen tijd", "Klant wilde direct bestellen", "Vergeten", "Anders"]
  },
  polis_afgesloten: {
    title: "Waarom is polis niet afgesloten?",
    intro: "Deze toelichting wordt opgeslagen bij polis.",
    options: ["Klant elders verzekerd", "Prijs te hoog", "Nog in beraad", "Geen interesse", "Anders"]
  },
  fin_besproken: {
    title: "Waarom is financiering niet besproken?",
    intro: "Deze toelichting wordt opgeslagen bij financiering.",
    options: ["Geen tijd", "Klant wilde direct bestellen", "Vergeten", "Anders"]
  },
  fin_afgesloten: {
    title: "Waarom is financiering niet afgesloten?",
    intro: "Deze toelichting wordt opgeslagen bij financiering.",
    options: ["Contant betaald", "Eigen financiering", "Maandbedrag te hoog", "Nog in beraad", "Geen interesse", "Anders"]
  }
};

function populateModalOptions(options){
  const select = $("modalReason");
  select.innerHTML = '<option value="">Kies</option>';
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt;
    select.appendChild(option);
  });
}

function modalIsOpen(){
  return !$("modalBackdrop").classList.contains("hidden");
}

function openModal(fieldKey){
  currentField = fieldKey;
  const cfg = modalConfigs[fieldKey];
  $("modalTitle").textContent = cfg.title;
  $("modalIntro").textContent = cfg.intro;
  populateModalOptions(cfg.options);
  $("modalReason").value = $(fieldKey + "_reden").value || "";
  $("modalNote").value = $(fieldKey + "_toelichting").value || "";
  zetModalFout("");
  $("modalBackdrop").classList.remove("hidden");
  $("modalReason").focus();
}

function zetModalFout(tekst){
  $("modalFout").textContent = tekst;
  $("modalReason").classList.remove("veld-mist");
  $("modalNote").classList.remove("veld-mist");
}

function closeModal(resetSelect){
  $("modalBackdrop").classList.add("hidden");
  zetModalFout("");
  if(resetSelect && currentField){
    const hasReason = $(currentField + "_reden").value;
    if(!hasReason){
      $(currentField).value = "";
    }
  }
  const veld = currentField ? $(currentField) : null;
  currentField = "";
  syncPrintData();
  if(veld && !veld.disabled) veld.focus();
}

function saveModal(){
  const reason = $("modalReason").value.trim();
  const note = $("modalNote").value.trim();

  if(!reason || !note){
    $("modalFout").textContent = "Vul zowel reden als toelichting in.";
    if(!reason) $("modalReason").classList.add("veld-mist");
    if(!note) $("modalNote").classList.add("veld-mist");
    (reason ? $("modalNote") : $("modalReason")).focus();
    return;
  }

  $(currentField + "_reden").value = reason;
  $(currentField + "_toelichting").value = note;

  const pill = $(currentField + "_info");
  if(pill) pill.style.display = "block";

  if(currentField === "polis_besproken"){
    const afgesloten = $("polis_afgesloten");
    afgesloten.value = "Nee";
    afgesloten.disabled = true;
    $("polis_afgesloten_reden").value = "";
    $("polis_afgesloten_toelichting").value = "";
    $("polis_afgesloten_info").style.display = "none";
  }

  if(currentField === "fin_besproken"){
    const afgesloten = $("fin_afgesloten");
    afgesloten.value = "Nee";
    afgesloten.disabled = true;
    $("fin_afgesloten_reden").value = "";
    $("fin_afgesloten_toelichting").value = "";
    $("fin_afgesloten_info").style.display = "none";
  }

  closeModal(false);
}

function attachModalBehavior(selectId){
  const el = $(selectId);

  el.addEventListener("change", function(){
    if(this.value === "Nee"){
      openModal(selectId);
    } else {
      const pill = $(selectId + "_info");
      if(pill) pill.style.display = "none";

      const reason = $(selectId + "_reden");
      const note = $(selectId + "_toelichting");

      if(reason) reason.value = "";
      if(note) note.value = "";

      if(selectId === "polis_besproken"){
        const afgesloten = $("polis_afgesloten");
        afgesloten.disabled = false;
        afgesloten.value = "";
        $("polis_afgesloten_reden").value = "";
        $("polis_afgesloten_toelichting").value = "";
        $("polis_afgesloten_info").style.display = "none";
      }

      if(selectId === "fin_besproken"){
        const afgesloten = $("fin_afgesloten");
        afgesloten.disabled = false;
        afgesloten.value = "";
        $("fin_afgesloten_reden").value = "";
        $("fin_afgesloten_toelichting").value = "";
        $("fin_afgesloten_info").style.display = "none";
      }
    }
    syncPrintData();
  });
}

/* ---------- blokken die verschijnen of verdwijnen ---------- */
function toggleNieuwBlok(){
  const soort = $("soort_voertuig").value;
  const blokNieuw = $("blok_nieuw");
  const blokOccasion = $("blok_occasion");

  if(soort === "Nieuw"){
    blokNieuw.classList.remove("hidden");
    blokOccasion.classList.add("hidden");
    $("kenteken").value = "";
  } else if(soort === "Occasion"){
    blokNieuw.classList.add("hidden");
    blokOccasion.classList.remove("hidden");

    $("ivn_bekend").value = "";
    $("ivn").value = "";
    $("dad").value = "";
    $("voorraadpremie_van_toepassing").value = "";
    $("voorraadpremie_bedrag").value = "";
    $("inruilpremie_van_toepassing").value = "";
    $("inruilpremie_bruto").value = "";
    $("verhouding").value = "60/40";
    $("uiterste_registratiedatum").value = "";
    $("nieuw_notitie").value = "";

    $("blok_voorraad_bedrag").classList.add("hidden");
    $("blok_inruilpremie_van_toepassing").classList.add("hidden");
    $("blok_inruil_bedrag").classList.add("hidden");
  } else {
    blokNieuw.classList.add("hidden");
    blokOccasion.classList.add("hidden");
    $("kenteken").value = "";
  }

  toggleInruilBlok();
  toggleVoorraadpremie();
  toggleInruilpremie();
  syncPrintData();
}

function toggleInruilBlok(){
  const inruil = $("inruil").value;
  const soort = $("soort_voertuig").value;

  const blokEigenMerk = $("blok_eigen_merk");
  const blokBoekwaarde = $("blok_boekwaarde");
  const blokInruilpremieVT = $("blok_inruilpremie_van_toepassing");
  const blokInruilBedrag = $("blok_inruil_bedrag");

  if(inruil === "Ja"){
    blokEigenMerk.classList.remove("hidden");
    blokBoekwaarde.classList.remove("hidden");

    if(soort === "Nieuw"){
      blokInruilpremieVT.classList.remove("hidden");
    } else {
      blokInruilpremieVT.classList.add("hidden");
      $("inruilpremie_van_toepassing").value = "";
      $("inruilpremie_bruto").value = "";
      blokInruilBedrag.classList.add("hidden");
    }
  } else {
    blokEigenMerk.classList.add("hidden");
    blokBoekwaarde.classList.add("hidden");
    blokInruilpremieVT.classList.add("hidden");
    blokInruilBedrag.classList.add("hidden");

    $("eigen_merk").value = "";
    $("boekwaarde").value = "";
    $("inruilpremie_van_toepassing").value = "";
    $("inruilpremie_bruto").value = "";
  }

  toggleInruilpremie();
  syncPrintData();
}

function toggleVoorraadpremie(){
  const val = $("voorraadpremie_van_toepassing").value;
  const blok = $("blok_voorraad_bedrag");
  const input = $("voorraadpremie_bedrag");

  if($("soort_voertuig").value !== "Nieuw"){
    blok.classList.add("hidden");
    input.value = "";
    return;
  }

  if(val === "Ja"){
    blok.classList.remove("hidden");
  } else {
    blok.classList.add("hidden");
    input.value = "";
  }
  syncPrintData();
}

function toggleInruilpremie(){
  const val = $("inruilpremie_van_toepassing").value;
  const blok = $("blok_inruil_bedrag");
  const input = $("inruilpremie_bruto");

  const soortNieuw = $("soort_voertuig").value === "Nieuw";
  const inruilJa = $("inruil").value === "Ja";

  if(!soortNieuw || !inruilJa){
    blok.classList.add("hidden");
    input.value = "";
    return;
  }

  if(val === "Ja"){
    blok.classList.remove("hidden");
  } else {
    blok.classList.add("hidden");
    input.value = "";
  }
  syncPrintData();
}

/* ---------- waarden lezen en het A4-overzicht bijwerken ---------- */
function val(id){
  const el = document.getElementById(id);
  return el ? (el.value || "").trim() : "";
}

function printable(id){
  const value = val(id);
  return value || "-";
}

function euro(id){
  const v = val(id);
  if(!v) return "-";
  return fmtEuro(v);
}

function setPrintField(id, value){
  const el = document.getElementById(id);
  if(el) el.textContent = value || "-";
}

function syncPrintData(){
  setPrintField("p_vestiging", printable("vestiging"));
  setPrintField("p_ordernummer", printable("ordernummer"));
  setPrintField("p_orderdatum", printable("orderdatum"));
  setPrintField("p_klantnaam", printable("klantnaam"));
  setPrintField("p_email_factuur", printable("email_factuur"));
  setPrintField("p_email_pech", printable("email_pech"));

  setPrintField("p_polis_besproken", printable("polis_besproken"));
  setPrintField("p_polis_besproken_reden", printable("polis_besproken_reden"));
  setPrintField("p_polis_besproken_toelichting", printable("polis_besproken_toelichting"));
  setPrintField("p_polis_afgesloten", printable("polis_afgesloten"));
  setPrintField("p_polis_afgesloten_reden", printable("polis_afgesloten_reden"));
  setPrintField("p_polis_afgesloten_toelichting", printable("polis_afgesloten_toelichting"));

  setPrintField("p_fin_besproken", printable("fin_besproken"));
  setPrintField("p_fin_besproken_reden", printable("fin_besproken_reden"));
  setPrintField("p_fin_besproken_toelichting", printable("fin_besproken_toelichting"));
  setPrintField("p_fin_afgesloten", printable("fin_afgesloten"));
  setPrintField("p_fin_afgesloten_reden", printable("fin_afgesloten_reden"));
  setPrintField("p_fin_afgesloten_toelichting", printable("fin_afgesloten_toelichting"));

  setPrintField("p_soort_voertuig", printable("soort_voertuig"));
  setPrintField("p_kenteken", printable("kenteken"));
  setPrintField("p_afleverdatum", printable("afleverdatum"));
  setPrintField("p_aflevertijd", printable("aflevertijd"));
  setPrintField("p_agenda_opmerking", printable("agenda_opmerking"));

  setPrintField("p_inruil", printable("inruil"));
  setPrintField("p_eigen_merk", printable("eigen_merk"));
  setPrintField("p_boekwaarde", euro("boekwaarde"));
  setPrintField("p_extra_notitie", printable("extra_notitie"));

  setPrintField("p_ivn_bekend", printable("ivn_bekend"));
  setPrintField("p_ivn", printable("ivn"));
  setPrintField("p_dad", printable("dad"));
  setPrintField("p_voorraadpremie_van_toepassing", printable("voorraadpremie_van_toepassing"));
  setPrintField("p_voorraadpremie_bedrag", euro("voorraadpremie_bedrag"));
  setPrintField("p_inruilpremie_van_toepassing", printable("inruilpremie_van_toepassing"));
  setPrintField("p_inruilpremie_bruto", euro("inruilpremie_bruto"));
  setPrintField("p_verhouding", printable("verhouding"));
  setPrintField("p_uiterste_registratiedatum", printable("uiterste_registratiedatum"));
  setPrintField("p_nieuw_notitie", printable("nieuw_notitie"));

  setPrintField("p_toe_te_betalen", euro("toe_te_betalen"));
  setPrintField("p_betaal_opmerking", printable("betaal_opmerking"));
  setPrintField("p_algemene_opmerking", printable("algemene_opmerking"));

  werkVoetBij();
}

/* ---------- verkoopleider, controle en mailtekst ---------- */
function getManagerEmail(){
  return verkoopleiderVoor(val("vestiging"), val("soort_voertuig"));
}

function checkRules(){
  const issues = [];

  if(val("ordernummer") && !/^\d+$/.test(val("ordernummer"))){
    issues.push("Ordernummer mag alleen cijfers bevatten");
  }

  if(val("polis_besproken") === "Nee"){
    if(!val("polis_besproken_reden")) issues.push("Polis niet besproken, reden ontbreekt");
    if(!val("polis_besproken_toelichting")) issues.push("Polis niet besproken, toelichting ontbreekt");
  }

  if(val("polis_besproken") === "Ja" && val("polis_afgesloten") === "Nee"){
    if(!val("polis_afgesloten_reden")) issues.push("Polis niet afgesloten, reden ontbreekt");
    if(!val("polis_afgesloten_toelichting")) issues.push("Polis niet afgesloten, toelichting ontbreekt");
  }

  if(val("fin_besproken") === "Nee"){
    if(!val("fin_besproken_reden")) issues.push("Financiering niet besproken, reden ontbreekt");
    if(!val("fin_besproken_toelichting")) issues.push("Financiering niet besproken, toelichting ontbreekt");
  }

  if(val("fin_besproken") === "Ja" && val("fin_afgesloten") === "Nee"){
    if(!val("fin_afgesloten_reden")) issues.push("Financiering niet afgesloten, reden ontbreekt");
    if(!val("fin_afgesloten_toelichting")) issues.push("Financiering niet afgesloten, toelichting ontbreekt");
  }

  if(val("soort_voertuig") === "Nieuw"){
    if(val("voorraadpremie_van_toepassing") === "Ja" && !val("voorraadpremie_bedrag")){
      issues.push("Voorraadpremie bedrag ontbreekt");
    }

    if(val("inruil") === "Ja" && val("inruilpremie_van_toepassing") === "Ja" && !val("inruilpremie_bruto")){
      issues.push("Inruilpremie bruto ontbreekt");
    }

    if(val("ivn_bekend") === "Ja" && !val("ivn")){
      issues.push("IVN ontbreekt");
    }
  }

  if(val("soort_voertuig") === "Occasion" && !val("kenteken")){
    issues.push("Kenteken ontbreekt");
  }

  if(!val("toe_te_betalen")) issues.push("Toe te betalen bedrag ontbreekt");
  if(!val("vestiging")) issues.push("Vestiging ontbreekt");
  if(!val("ordernummer")) issues.push("Ordernummer ontbreekt");
  if(!val("orderdatum")) issues.push("Orderdatum ontbreekt");
  if(!val("klantnaam")) issues.push("Klantnaam ontbreekt");
  if(!val("email_factuur")) issues.push("E-mailadres voor factuur ontbreekt");
  if(!val("email_pech")) issues.push("E-mailadres voor pechhulppas ontbreekt");
  if(!val("soort_voertuig")) issues.push("Nieuw of occasion ontbreekt");
  if(!val("afleverdatum")) issues.push("Afleverdatum ontbreekt");
  if(!val("aflevertijd")) issues.push("Aflevertijd ontbreekt");
  if(!val("inruil")) issues.push("Inruil keuze ontbreekt");

  return issues;
}

function buildMailText(){
  const issues = checkRules();
  const header = issues.length ? "LET OP: " + issues.join(" | ") + "\n\n" : "";

  return [
    "Formuliernummer: " + (huidigId || "-"),
    "",
    header + "ADG AFLEVERFORMULIER",
    "",
    "1. BASISGEGEVENS",
    "Vestiging: " + printable("vestiging"),
    "Ordernummer: " + printable("ordernummer"),
    "Orderdatum: " + printable("orderdatum"),
    "Klantnaam: " + printable("klantnaam"),
    "E-mailadres factuur: " + printable("email_factuur"),
    "E-mailadres pechhulppas: " + printable("email_pech"),
    "",
    "2. POLIS",
    "Polis besproken: " + printable("polis_besproken"),
    "Waarom niet besproken: " + printable("polis_besproken_reden"),
    "Toelichting niet besproken: " + printable("polis_besproken_toelichting"),
    "Polis afgesloten: " + printable("polis_afgesloten"),
    "Waarom niet afgesloten: " + printable("polis_afgesloten_reden"),
    "Toelichting niet afgesloten: " + printable("polis_afgesloten_toelichting"),
    "",
    "3. FINANCIERING",
    "Financiering besproken: " + printable("fin_besproken"),
    "Waarom niet besproken: " + printable("fin_besproken_reden"),
    "Toelichting niet besproken: " + printable("fin_besproken_toelichting"),
    "Financiering afgesloten: " + printable("fin_afgesloten"),
    "Waarom niet afgesloten: " + printable("fin_afgesloten_reden"),
    "Toelichting niet afgesloten: " + printable("fin_afgesloten_toelichting"),
    "",
    "4. VOERTUIG",
    "Nieuw of occasion: " + printable("soort_voertuig"),
    "Kenteken: " + printable("kenteken"),
    "Afleverdatum: " + printable("afleverdatum"),
    "Aflevertijd: " + printable("aflevertijd"),
    "Agenda opmerking: " + printable("agenda_opmerking"),
    "",
    "5. INRUIL",
    "Inruil: " + printable("inruil"),
    "Eigen merk: " + printable("eigen_merk"),
    "Boekwaarde: " + euro("boekwaarde"),
    "Extra notitie: " + printable("extra_notitie"),
    "",
    "6. NIEUW",
    "IVN bekend: " + printable("ivn_bekend"),
    "IVN: " + printable("ivn"),
    "DAD: " + printable("dad"),
    "Voorraadpremie van toepassing: " + printable("voorraadpremie_van_toepassing"),
    "Hoogte voorraadpremie: " + euro("voorraadpremie_bedrag"),
    "Inruilpremie van toepassing: " + printable("inruilpremie_van_toepassing"),
    "Inruilpremie bruto: " + euro("inruilpremie_bruto"),
    "Standaard verhouding: " + printable("verhouding"),
    "Uiterste registratiedatum: " + printable("uiterste_registratiedatum"),
    "Extra notitie nieuw: " + printable("nieuw_notitie"),
    "",
    "7. FINANCIËLE AFHANDELING",
    "Toe te betalen bedrag: " + euro("toe_te_betalen"),
    "Opmerking betaling: " + printable("betaal_opmerking"),
    "",
    "8. OPMERKINGEN OF BIJZONDERHEDEN",
    "Algemene opmerkingen: " + printable("algemene_opmerking")
  ].join("\n");
}

/* De mail openen. Aparte functie zodat een test hem kan vervangen en de URL kan vangen,
   zonder dat er echt een mailprogramma opent. */
function openMail(url){
  location.href = url;
}

/* ---------- velden verzamelen en invullen ---------- */
function formulierVelden(){
  return Array.from(document.querySelectorAll("#adgForm input, #adgForm select, #adgForm textarea"))
    .filter(el => el.id);
}

/* Alle velden als { veld-id: waarde }, ook de vergrendelde en de verborgen reden- en
   toelichtingsvelden. Bewust niet FormData: die slaat uitgeschakelde velden over, en
   "afgesloten" staat na een nee bij "besproken" uitgeschakeld op nee. */
function verzamel(){
  const o = {};
  formulierVelden().forEach(el => { o[el.id] = el.value; });
  return o;
}

/* Eerst alle waarden zetten, dan de blokken laten kloppen (zie laadFormulier). */
function vul(data){
  formulierVelden().forEach(el => {
    if(data && Object.prototype.hasOwnProperty.call(data, el.id)){
      const v = data[el.id];
      el.value = (v === null || v === undefined) ? "" : String(v);
    }
  });
}

/* Na het vullen: vergrendelde "afgesloten"-velden en de pillen met reden terugzetten. */
function herstelVergrendeling(){
  [["polis_besproken", "polis_afgesloten"], ["fin_besproken", "fin_afgesloten"]].forEach(([besproken, afgesloten]) => {
    if(val(besproken) === "Nee" && val(besproken + "_reden")){
      $(afgesloten).value = "Nee";
      $(afgesloten).disabled = true;
    }
  });
  ["polis_besproken", "polis_afgesloten", "fin_besproken", "fin_afgesloten"].forEach(k => {
    const pill = $(k + "_info");
    if(pill) pill.style.display = val(k + "_reden") ? "block" : "none";
  });
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

/* ---------- voet: status, knoppen ---------- */
function setVoet(tekst, soort){
  const el = $("voetStatus");
  el.textContent = tekst || "";
  el.className = "voet-status" + (soort === "fout" ? " fout-tekst" : soort === "ok" ? " ok-tekst" : "");
}

/* Wijzigingen na het opslaan: de voet zegt dat er iets nog niet is opgeslagen. */
function werkVoetBij(){
  if(laatsteOpslag === null || alleenLezen || bezig) return;
  if(isDirty()) setVoet("Wijzigingen nog niet opgeslagen", "");
  else setVoet(voetBasis, voetBasis ? "ok" : "");
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
  nr.textContent = "Formuliernummer " + huidigId;
  const badge = document.createElement("span");
  badge.className = "badge " + huidigeStatus;
  badge.textContent = huidigeStatus === "ingediend" ? "Ingediend" : "Concept";
  el.append(nr, badge);
  $("p_nummer").textContent = huidigId;
  $("knopIndienen").textContent = huidigeStatus === "ingediend" ? "Opnieuw indienen" : "Indienen";
}

function zetBusy(aan, knop){
  ["knopOpslaan", "knopPrint", "knopIndienen"].forEach(id => { $(id).disabled = aan; });
  if(knop) knop.classList.toggle("btn-busy", aan);
}

/* ---------- opslaan ---------- */
async function slaOp(indienen, knop){
  if(bezig) return false;
  bezig = true;
  zetBusy(true, knop);
  setVoet("", "");
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
  wisRegelMelding();
  if(await slaOp(false, $("knopOpslaan"))) werkVoetBij();
}

/* ---------- indienen: eerst controleren, dan opslaan, dan de mail ---------- */
const ISSUE_VELDEN = {
  "Ordernummer mag alleen cijfers bevatten": "ordernummer",
  "Polis niet besproken, reden ontbreekt": "polis_besproken",
  "Polis niet besproken, toelichting ontbreekt": "polis_besproken",
  "Polis niet afgesloten, reden ontbreekt": "polis_afgesloten",
  "Polis niet afgesloten, toelichting ontbreekt": "polis_afgesloten",
  "Financiering niet besproken, reden ontbreekt": "fin_besproken",
  "Financiering niet besproken, toelichting ontbreekt": "fin_besproken",
  "Financiering niet afgesloten, reden ontbreekt": "fin_afgesloten",
  "Financiering niet afgesloten, toelichting ontbreekt": "fin_afgesloten",
  "Voorraadpremie bedrag ontbreekt": "voorraadpremie_bedrag",
  "Inruilpremie bruto ontbreekt": "inruilpremie_bruto",
  "IVN ontbreekt": "ivn",
  "Kenteken ontbreekt": "kenteken",
  "Toe te betalen bedrag ontbreekt": "toe_te_betalen",
  "Vestiging ontbreekt": "vestiging",
  "Ordernummer ontbreekt": "ordernummer",
  "Orderdatum ontbreekt": "orderdatum",
  "Klantnaam ontbreekt": "klantnaam",
  "E-mailadres voor factuur ontbreekt": "email_factuur",
  "E-mailadres voor pechhulppas ontbreekt": "email_pech",
  "Nieuw of occasion ontbreekt": "soort_voertuig",
  "Afleverdatum ontbreekt": "afleverdatum",
  "Aflevertijd ontbreekt": "aflevertijd",
  "Inruil keuze ontbreekt": "inruil"
};

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
  kop.textContent = "Het formulier is nog niet compleet:";
  const lijst = document.createElement("ul");
  issues.forEach(tekst => {
    const li = document.createElement("li");
    li.textContent = tekst;
    lijst.appendChild(li);
    const id = ISSUE_VELDEN[tekst];
    if(id && $(id)) $(id).classList.add("veld-mist");
  });
  box.append(kop, lijst);
  box.classList.remove("hidden");
  box.classList.remove("schud");
  void box.offsetWidth;
  box.classList.add("schud");

  const rustig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gedrag = rustig ? "auto" : "smooth";
  if(window.matchMedia("(min-width: 901px)").matches){
    $("paneScroll").scrollTo({ top: 0, behavior: gedrag });
  } else {
    box.scrollIntoView({ behavior: gedrag, block: "start" });
  }
  box.focus({ preventScroll: true });
}

async function indienen(){
  if(alleenLezen || bezig) return;

  const issues = checkRules();
  if(issues.length){
    toonRegels(issues);
    return;
  }
  const managerEmail = getManagerEmail();
  if(!managerEmail){
    toonRegels(["Er kon geen verkoopleider worden bepaald op basis van vestiging en voertuigtype"]);
    return;
  }
  wisRegelMelding();

  if(!await slaOp(true, $("knopIndienen"))) return;
  setVoet(voetBasis + ". Je mailprogramma opent nu.", "ok");

  const subject = `ADG Afleverformulier | ${val("vestiging")} | Order ${val("ordernummer")} | ${val("klantnaam")}`;
  const body = buildMailText();

  const to = ADMINISTRATIE_MAIL;
  const cc = managerEmail;

  const mailto = `mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  openMail(mailto);
}

/* De oude naam blijft bestaan voor wie hem nog aanroept. */
function sendFormEmail(){ return indienen(); }

function printDocument(){
  syncPrintData();
  window.print();
}

/* ---------- alleen lezen ---------- */
function zetAlleenLezen(verkoperNaam){
  alleenLezen = true;
  formulierVelden().forEach(el => { el.disabled = true; });
  $("knopOpslaan").classList.add("hidden");
  $("knopIndienen").classList.add("hidden");
  document.querySelector(".voet-knoppen").classList.add("alleen-print");
  const m = $("melding_eigenaar");
  m.textContent = "Dit formulier is van " + verkoperNaam + ". Je kunt het bekijken en printen, niet aanpassen.";
  m.classList.remove("hidden");
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
    return;
  }
  const rij = Array.isArray(res.data) ? res.data[0] : res.data;
  if(!rij){
    toonNietGevonden("Formulier " + id + " is niet gevonden", false);
    return;
  }

  huidigId = String(rij.id || id);
  huidigeStatus = rij.status === "ingediend" ? "ingediend" : "concept";

  vul(rij.data || {});
  toggleNieuwBlok();          // draait ook de andere toggles
  herstelVergrendeling();
  syncPrintData();
  werkSubregelBij();
  laatsteOpslag = JSON.stringify(verzamel());

  if(rij.mag_bewerken === false){
    zetAlleenLezen(naamVan(rij.verkoper_naam, rij.verkoper));
  }
}

/* ---------- opstarten ---------- */
function koppelGebeurtenissen(){
  ["polis_besproken", "polis_afgesloten", "fin_besproken", "fin_afgesloten"].forEach(attachModalBehavior);

  $("soort_voertuig").addEventListener("change", toggleNieuwBlok);
  $("inruil").addEventListener("change", toggleInruilBlok);
  $("voorraadpremie_van_toepassing").addEventListener("change", toggleVoorraadpremie);
  $("inruilpremie_van_toepassing").addEventListener("change", toggleInruilpremie);

  formulierVelden().forEach(el => {
    el.addEventListener("change", syncPrintData);
    el.addEventListener("input", syncPrintData);
    const wis = () => el.classList.remove("veld-mist");
    el.addEventListener("input", wis);
    el.addEventListener("change", wis);
  });

  $("modalReason").addEventListener("change", () => zetModalFout(""));
  $("modalNote").addEventListener("input", () => zetModalFout(""));
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && modalIsOpen()) closeModal(true);
  });

  $("terugKnop").addEventListener("click", terugNaarStart);
  $("knopOpslaan").addEventListener("click", opslaan);
  $("knopPrint").addEventListener("click", printDocument);
  $("knopIndienen").addEventListener("click", indienen);
}

koppelGebeurtenissen();
toggleNieuwBlok();

(async function start(){
  const ik = await vereisLogin();
  if(!ik) return;

  const id = (new URLSearchParams(location.search).get("id") || "").trim();
  if(id){
    await laadFormulier(id);
  } else {
    laatsteOpslag = JSON.stringify(verzamel());
  }
})();
