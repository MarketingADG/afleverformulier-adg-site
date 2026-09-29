/* Overzicht van alle afleverformulieren. Opbouw: filteren en sorteren gebeurt hier in de
   browser op de lijst die formulieren_list teruggeeft (zonder de volledige gegevens). */
"use strict";

(async () => {
  const ik = await vereisLogin();
  if (!ik) return;

  const $ = id => document.getElementById(id);
  const lijstEl = $("lijst");
  let rijen = [];
  let laadFout = "";
  let klaar = false;      // is er al één keer geladen
  let bezig = 0;          // teller om verouderde antwoorden te negeren

  const PRULLENBAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  /* ---- filters vullen ---- */
  $("f_vestiging").innerHTML = '<option value="">Alle vestigingen</option>' +
    VESTIGINGEN.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");

  function vulVerkopers() {
    const sel = $("f_verkoper");
    const huidig = sel.value;
    const uniek = new Map();
    rijen.forEach(r => { if (r.verkoper && !uniek.has(r.verkoper)) uniek.set(r.verkoper, r.verkoper_naam || r.verkoper); });
    const lijst = [...uniek.entries()].sort((a, b) => a[1].localeCompare(b[1], "nl"));
    sel.innerHTML = '<option value="">Alle verkopers</option>' +
      lijst.map(([u, n]) => `<option value="${esc(u)}">${esc(n)}</option>`).join("");
    sel.value = uniek.has(huidig) ? huidig : "";
  }

  /* ---- zoeken ---- */
  const kaal = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function past(r, q) {
    if (!q) return true;
    const ruw = q.toLowerCase();
    const velden = [r.klantnaam, r.ordernummer, r.kenteken, r.id, r.verkoper_naam, r.verkoper];
    if (velden.some(v => String(v || "").toLowerCase().includes(ruw))) return true;
    const k = kaal(q);   // kenteken met of zonder streepjes
    return k.length > 0 && kaal(r.kenteken).includes(k);
  }

  function gefilterd() {
    const q = $("zoek").value.trim();
    const ves = $("f_vestiging").value, sta = $("f_status").value, vk = $("f_verkoper").value;
    const uit = rijen.filter(r =>
      (!ves || r.vestiging === ves) && (!sta || r.status === sta) && (!vk || r.verkoper === vk) && past(r, q));
    if ($("f_sortering").value === "afleverdatum") {
      // nieuwste aflevering bovenaan, formulieren zonder datum onderaan
      uit.sort((a, b) => {
        if (!a.afleverdatum && !b.afleverdatum) return String(b.updated_at).localeCompare(String(a.updated_at));
        if (!a.afleverdatum) return 1;
        if (!b.afleverdatum) return -1;
        return (b.afleverdatum + " " + (b.aflevertijd || "")).localeCompare(a.afleverdatum + " " + (a.aflevertijd || ""));
      });
    } else {
      uit.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }
    return uit;
  }

  /* ---- tekenen ---- */
  function regel(r, i, animeer) {
    const naam = (r.klantnaam || "").trim();
    const meta = [];
    if (r.ordernummer) meta.push("Order " + r.ordernummer);
    if (r.kenteken) meta.push(r.kenteken);
    if (r.vestiging) meta.push(r.vestiging);
    if (r.soort) meta.push(r.soort);
    const dat = fmtDatum(r.afleverdatum);
    if (dat) meta.push("aflevering " + dat + (r.aflevertijd ? ", " + r.aflevertijd : ""));
    const vk = r.verkoper_naam || r.verkoper;
    if (vk) meta.push(vk);
    const ingediend = r.status === "ingediend";
    const eigenConcept = !ingediend && r.verkoper === ik.username;
    const gewijzigd = fmtMoment(r.updated_at);
    const stijl = animeer ? ` in-beeld" style="--i:${i < 12 ? i : 0}` : "";
    return `<div class="lijst-item${stijl}" role="link" tabindex="0" data-id="${esc(r.id)}">
      <div class="links">
        <div class="who">${naam ? esc(naam) : '<span class="zonder">Zonder klantnaam</span>'}
          <span class="badge ${ingediend ? "ingediend" : "concept"}">${ingediend ? "Ingediend" : "Concept"}</span></div>
        <div class="meta2">${meta.map(esc).join(" · ")}</div>
      </div>
      <div class="rechts">
        <div class="nr">${esc(r.id)}</div>
        <div class="meta2">${gewijzigd ? "gewijzigd " + esc(gewijzigd) : ""}</div>
      </div>
      ${eigenConcept ? `<button type="button" class="item-del" data-verwijder="${esc(r.id)}" aria-label="Concept van ${esc(naam || "zonder klantnaam")} verwijderen" title="Verwijder dit concept">${PRULLENBAK}</button>` : '<span class="item-del-plek"></span>'}
    </div>`;
  }

  function teken(animeer) {
    const telling = $("telling");
    if (laadFout) {
      telling.textContent = "";
      lijstEl.innerHTML = `<div class="melding let-op">De lijst kon niet worden geladen. ${esc(laadFout)}
        <button type="button" class="knop-sec" id="opnieuw">Opnieuw</button></div>`;
      $("opnieuw").onclick = () => laad(false);
      return;
    }
    if (!klaar) return;
    if (!rijen.length) {
      telling.textContent = "";
      lijstEl.innerHTML = '<div class="lijst-leeg">Nog geen afleverformulieren. Maak het eerste aan met de knop hieronder.</div>';
      return;
    }
    const uit = gefilterd();
    telling.textContent = uit.length === rijen.length
      ? `${rijen.length} ${rijen.length === 1 ? "formulier" : "formulieren"}`
      : `${uit.length} van ${rijen.length} formulieren`;
    if (!uit.length) {
      lijstEl.innerHTML = '<div class="lijst-leeg">Geen formulieren gevonden met deze zoekterm en filters.<button type="button" class="knop-klein" id="wis">Filters wissen</button></div>';
      $("wis").onclick = () => {
        $("zoek").value = ""; $("f_vestiging").value = ""; $("f_status").value = ""; $("f_verkoper").value = "";
        teken(false);
      };
      return;
    }
    lijstEl.innerHTML = uit.map((r, i) => regel(r, i, animeer)).join("");
  }

  /* ---- laden ---- */
  async function laad(stil) {
    const nr = ++bezig;
    if (!stil) {
      laadFout = "";
      klaar = false;
      $("telling").textContent = "";
      lijstEl.innerHTML = '<div class="laadvlak laadregel"></div>'.repeat(5);
    }
    const { data, error } = await rpcMetSessie("formulieren_list");
    if (nr !== bezig) return;          // een nieuwere aanroep is onderweg of klaar
    if (error) {
      if (stil) return;                // op de achtergrond verversen: oude lijst laten staan
      laadFout = error.message || "Onbekende fout.";
      teken(false);
      return;
    }
    rijen = Array.isArray(data) ? data : [];
    laadFout = "";
    const eerste = !klaar;
    klaar = true;
    vulVerkopers();
    teken(eerste && !stil);
  }

  /* ---- verwijderen ---- */
  const foutEl = $("verwijder_fout");
  function toonFout(tekst) {
    foutEl.textContent = tekst;
    foutEl.classList.remove("hidden", "schud");
    void foutEl.offsetWidth;
    foutEl.classList.add("schud");
  }
  async function verwijder(id, knop) {
    const r = rijen.find(x => x.id === id);
    const naam = r && (r.klantnaam || "").trim();
    if (!confirm(`Concept ${id}${naam ? " van " + naam : ""} verwijderen? Dit kun je niet ongedaan maken.`)) return;
    foutEl.classList.add("hidden");
    knop.disabled = true;
    const { error } = await rpcMetSessie("formulier_verwijderen", { p_id: id });
    if (error) {
      knop.disabled = false;
      toonFout("Verwijderen mislukt. " + (error.message || ""));
      return;
    }
    rijen = rijen.filter(x => x.id !== id);
    vulVerkopers();
    teken(false);
  }

  /* ---- events ---- */
  const open = id => { location.href = "formulier.html?id=" + encodeURIComponent(id); };
  lijstEl.addEventListener("click", e => {
    const del = e.target.closest("[data-verwijder]");
    if (del) { e.stopPropagation(); verwijder(del.dataset.verwijder, del); return; }
    const item = e.target.closest(".lijst-item");
    if (item) open(item.dataset.id);
  });
  lijstEl.addEventListener("keydown", e => {
    if (e.target.closest("[data-verwijder]")) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".lijst-item");
    if (item && e.target === item) { e.preventDefault(); open(item.dataset.id); }
  });
  ["input"].forEach(ev => $("zoek").addEventListener(ev, () => teken(false)));
  ["f_vestiging", "f_status", "f_verkoper", "f_sortering"].forEach(id =>
    $(id).addEventListener("change", () => teken(false)));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && klaar) laad(true);
  });

  await laad(false);
})();
