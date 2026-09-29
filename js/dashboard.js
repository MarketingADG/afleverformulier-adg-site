/* Afleverdashboard. De database levert alle formulieren inclusief gegevens (alleen met
   dashboardrecht); filteren en tellen gebeurt hier in de browser. */
"use strict";

(async () => {
  const ik = await vereisLogin({ dashboard: true });
  if (!ik) return;

  const $ = id => document.getElementById(id);
  const DAG_MS = 86400000;
  const DEADLINE_DAGEN = 6;   // uiterlijk 6 dagen voor de aflevering indienen
  const KOMEND_DAGEN = 14;
  const GEEN_REDEN = "Geen reden ingevuld";

  let alle = [];
  let eersteRender = true;
  let bezig = 0;

  $("d_vestiging").innerHTML = '<option value="">Alle vestigingen</option>' +
    VESTIGINGEN.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");

  /* ---------- datumhulp, alles op lokale kalenderdagen ---------- */
  const p2 = n => String(n).padStart(2, "0");
  const sleutel = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  const dagStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const plusDagen = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const vanSleutel = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const dagKort = s => vanSleutel(s).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  const kort = d => d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

  /* ---------- velden uit een formulier ---------- */
  const veld = (f, k) => {
    const v = f.data && typeof f.data === "object" ? f.data[k] : "";
    return typeof v === "string" ? v.trim() : "";
  };
  const soortVan = f => (f.soort || veld(f, "soort_voertuig") || "").trim();
  const isIngediend = f => f.status === "ingediend";

  /* uiterlijk indienen = afleverdatum min 6 dagen; later dan dat is te laat */
  function deadline(f) {
    if (!f.afleverdatum) return "";
    return sleutel(plusDagen(vanSleutel(f.afleverdatum), -DEADLINE_DAGEN));
  }
  function teLaat(f) {
    if (!isIngediend(f) || !f.ingediend_op) return false;
    const dl = deadline(f), d = new Date(f.ingediend_op);
    return !!dl && !isNaN(d) && sleutel(d) > dl;
  }

  /* ---------- filters ---------- */
  function filters() {
    return { periode: $("d_periode").value, soort: $("d_soort").value, vestiging: $("d_vestiging").value };
  }
  const basis = (f, fl) => (!fl.soort || soortVan(f) === fl.soort) && (!fl.vestiging || f.vestiging === fl.vestiging);
  function periodeStart(fl) {
    const nu = new Date();
    if (fl.periode === "jaar") return new Date(nu.getFullYear(), 0, 1);
    return plusDagen(dagStart(nu), -(Number(fl.periode) - 1));   // vandaag telt mee
  }

  /* ---------- polis en financiering ---------- */
  function pfTelling(rijen, voor) {
    const invullen = rijen.filter(f => ["Ja", "Nee"].includes(veld(f, voor + "_besproken")));
    const besproken = invullen.filter(f => veld(f, voor + "_besproken") === "Ja").length;
    const afgesloten = invullen.filter(f => veld(f, voor + "_afgesloten") === "Ja").length;
    const tel = new Map();
    const teltReden = (lijst, sleutelNaam) => {
      const m = new Map();
      lijst.forEach(f => { const r = veld(f, sleutelNaam) || GEEN_REDEN; m.set(r, (m.get(r) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"));
    };
    return {
      basis: invullen.length, besproken, afgesloten,
      nietBesproken: teltReden(invullen.filter(f => veld(f, voor + "_besproken") === "Nee"), voor + "_besproken_reden"),
      // niet afgesloten telt alleen als het wel besproken is; bij niet besproken wordt afgesloten automatisch nee
      nietAfgesloten: teltReden(invullen.filter(f => veld(f, voor + "_besproken") === "Ja" && veld(f, voor + "_afgesloten") === "Nee"), voor + "_afgesloten_reden")
    };
  }
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;

  /* ---------- kleine bouwstenen ---------- */
  const cap = i => Math.min(i, 12);
  function balk(naam, breedte, nHtml, i, opt) {
    opt = opt || {};
    const w = Math.max(0, Math.min(100, breedte));
    return `<div class="lb-row${opt.reden ? " reden" : ""}">
      <span class="nm" title="${esc(naam)}">${esc(naam)}</span>
      <span class="track"><span class="bar${opt.ok ? " ok" : ""}${w === 0 ? " nul" : ""}" style="width:${w}%;--i:${cap(i)}"></span></span>
      <span class="n">${nHtml}</span></div>`;
  }
  const leeg = t => `<div class="leeg-sectie">${esc(t)}</div>`;
  const badge = f => `<span class="badge ${isIngediend(f) ? "ingediend" : "concept"}">${isIngediend(f) ? "Ingediend" : "Concept"}</span>`;
  const open = id => { location.href = "formulier.html?id=" + encodeURIComponent(id); };

  /* ---------- laadstaten ---------- */
  function laadStaat() {
    $("d_fout").innerHTML = "";
    $("d_komend").innerHTML = '<div class="laad-tabel">' + '<div class="laadvlak"></div>'.repeat(5) + "</div>";
    $("d_tegels").innerHTML = '<div class="tile laadvlak"></div>'.repeat(5);
    const rijen = '<div class="laad-rij">' + '<div class="laadvlak"></div>'.repeat(4) + "</div>";
    ["d_pf", "d_verkopers", "d_vestigingen"].forEach(id => { $(id).innerHTML = rijen; });
    $("d_laatste").innerHTML = '<div class="laadvlak laadregel"></div>'.repeat(3);
  }

  /* ---------- secties ---------- */
  function tekenKomend(fl) {
    const vandaag = dagStart(new Date());
    const van = sleutel(vandaag), tot = sleutel(plusDagen(vandaag, KOMEND_DAGEN)), binnen6 = sleutel(plusDagen(vandaag, DEADLINE_DAGEN));
    const rijen = alle.filter(f => basis(f, fl) && f.afleverdatum && f.afleverdatum >= van && f.afleverdatum <= tot)
      .sort((a, b) => (a.afleverdatum + " " + (a.aflevertijd || "99")).localeCompare(b.afleverdatum + " " + (b.aflevertijd || "99")));
    if (!rijen.length) { $("d_komend").innerHTML = leeg("Geen afleveringen in de komende 14 dagen."); return; }
    $("d_komend").innerHTML = `<table class="ds-tbl"><thead><tr>
      <th>Datum</th><th>Tijd</th><th>Klant</th><th>Vestiging</th><th>Soort</th><th>Verkoper</th><th>Status</th></tr></thead><tbody>` +
      rijen.map(f => {
        const naam = (f.klantnaam || "").trim();
        let lbl = "";
        if (teLaat(f)) lbl = '<span class="lbl-rij lbl-laat">te laat ingediend</span>';
        else if (!isIngediend(f) && f.afleverdatum <= binnen6) lbl = '<span class="lbl-rij lbl-open">nog niet ingediend</span>';
        return `<tr class="klik" tabindex="0" role="link" data-id="${esc(f.id)}">
          <td class="dag">${esc(dagKort(f.afleverdatum))}</td>
          <td class="tijd">${esc(f.aflevertijd || "")}</td>
          <td>${naam ? esc(naam) : '<span class="leeg">Zonder klantnaam</span>'}<div class="sub">${esc(f.id)}</div></td>
          <td>${esc(f.vestiging || "")}</td><td>${esc(soortVan(f))}</td>
          <td>${esc(f.verkoper_naam || f.verkoper || "")}</td>
          <td>${badge(f)}${lbl}</td></tr>`;
      }).join("") + "</tbody></table>";
  }

  function tekenTegels(rijen, ingediend, animeer) {
    if (!rijen.length) { $("d_tegels").innerHTML = leeg("Geen formulieren in deze periode met deze filters."); return; }
    const laat = ingediend.filter(teLaat).length;
    const polis = pfTelling(ingediend, "polis"), fin = pfTelling(ingediend, "fin");
    const tegel = (i, groot, label, sub, klas) =>
      `<div class="tile${animeer ? " in-beeld" : ""}" style="--i:${i}"><div class="big${klas ? " " + klas : ""}">${groot}</div>
       <div class="lbl">${esc(label)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
    const pf = (t, i, label) => t.basis
      ? tegel(i, pct(t.afgesloten, t.basis) + "%", label, `${t.afgesloten} van ${t.basis}`, "ok")
      : tegel(i, "–", label, "nog geen ingediende met antwoord");
    const concepten = rijen.length - ingediend.length;
    $("d_tegels").innerHTML =
      tegel(0, rijen.length, "Formulieren", "concept en ingediend") +
      tegel(1, ingediend.length, "Ingediend", concepten ? `${concepten} nog concept` : "geen concepten") +
      tegel(2, laat, "Te laat ingediend", ingediend.length ? `${laat} van ${ingediend.length} ingediend` : "nog niets ingediend", laat ? "laat" : "") +
      pf(polis, 3, "Polis afgesloten") + pf(fin, 4, "Financiering afgesloten");
  }

  function pfKolom(titel, t, offset) {
    if (!t.basis) return `<div><h3>${esc(titel)}</h3>${leeg("Nog geen ingediende formulieren met antwoord.")}</div>`;
    const lijst = (kop, regels, leegTekst) => {
      if (!regels.length) return `<h4>${esc(kop)}</h4><div class="geen">${esc(leegTekst)}</div>`;
      const max = regels[0][1];
      return `<h4>${esc(kop)}</h4>` + regels.map(([r, n], i) =>
        balk(r, 100 * n / max, `${n}`, i, { reden: true })).join("");
    };
    return `<div><h3>${esc(titel)}</h3>` +
      balk("Besproken", pct(t.besproken, t.basis), `${pct(t.besproken, t.basis)}% <em>${t.besproken}/${t.basis}</em>`, 0) +
      balk("Afgesloten", pct(t.afgesloten, t.basis), `${pct(t.afgesloten, t.basis)}% <em>${t.afgesloten}/${t.basis}</em>`, 1, { ok: true }) +
      lijst("Redenen niet besproken", t.nietBesproken, "Alles is besproken.") +
      lijst("Redenen niet afgesloten, wel besproken", t.nietAfgesloten, "Alles wat besproken is, is afgesloten.") + "</div>";
  }
  function tekenPF(ingediend) {
    if (!ingediend.length) { $("d_pf").innerHTML = leeg("Geen ingediende formulieren in deze periode."); return; }
    $("d_pf").innerHTML = '<div class="dash-kolommen">' +
      pfKolom("Polis", pfTelling(ingediend, "polis")) + pfKolom("Financiering", pfTelling(ingediend, "fin")) + "</div>";
  }

  function tekenVerkopers(rijen) {
    if (!rijen.length) { $("d_verkopers").innerHTML = leeg("Geen formulieren in deze periode."); return; }
    const per = new Map();
    rijen.forEach(f => {
      const k = f.verkoper || "";
      if (!per.has(k)) per.set(k, { naam: f.verkoper_naam || f.verkoper || "Onbekend", rijen: [] });
      per.get(k).rijen.push(f);
    });
    const lijst = [...per.values()].sort((a, b) => b.rijen.length - a.rijen.length || a.naam.localeCompare(b.naam, "nl"));
    const max = lijst[0].rijen.length;
    $("d_verkopers").innerHTML = lijst.map((v, i) => {
      const ing = v.rijen.filter(isIngediend);
      const p = pfTelling(ing, "polis"), fi = pfTelling(ing, "fin");
      return balk(v.naam, 100 * v.rijen.length / max,
        `${v.rijen.length} <em>polis ${p.afgesloten}/${p.basis} · fin ${fi.afgesloten}/${fi.basis}</em>`, i);
    }).join("");
  }

  function tekenVestigingen(rijen) {
    if (!rijen.length) { $("d_vestigingen").innerHTML = leeg("Geen formulieren in deze periode."); return; }
    const m = new Map();
    rijen.forEach(f => { const k = f.vestiging || "Zonder vestiging"; m.set(k, (m.get(k) || 0) + 1); });
    const lijst = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"));
    const max = lijst[0][1];
    $("d_vestigingen").innerHTML = lijst.map(([k, n], i) => balk(k, 100 * n / max, `${n}`, i)).join("");
  }

  function tekenLaatste(rijen, animeer) {
    if (!rijen.length) { $("d_laatste").innerHTML = leeg("Geen formulieren in deze periode."); return; }
    const nieuw = rijen.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
    $("d_laatste").innerHTML = nieuw.map((f, i) => {
      const naam = (f.klantnaam || "").trim();
      const meta = [];
      if (f.ordernummer) meta.push("Order " + f.ordernummer);
      if (f.vestiging) meta.push(f.vestiging);
      if (soortVan(f)) meta.push(soortVan(f));
      const dat = fmtDatum(f.afleverdatum);
      if (dat) meta.push("aflevering " + dat + (f.aflevertijd ? ", " + f.aflevertijd : ""));
      const vk = f.verkoper_naam || f.verkoper;
      if (vk) meta.push(vk);
      const stijl = animeer ? ` in-beeld" style="--i:${i}` : "";
      return `<div class="lijst-item${stijl}" role="link" tabindex="0" data-id="${esc(f.id)}">
        <div class="links"><div class="who">${naam ? esc(naam) : '<span class="zonder">Zonder klantnaam</span>'} ${badge(f)}</div>
          <div class="meta2">${meta.map(esc).join(" · ")}</div></div>
        <div class="rechts"><div class="nr">${esc(f.id)}</div>
          <div class="meta2">aangemaakt ${esc(fmtMoment(f.created_at))}</div></div></div>`;
    }).join("");
  }

  /* ---------- alles tekenen ---------- */
  function teken() {
    const fl = filters();
    const van = periodeStart(fl);
    $("d_periode_note").textContent = `Op aanmaakdatum van het formulier, van ${kort(van)} tot en met ${kort(new Date())}.`;
    const rijen = alle.filter(f => {
      if (!basis(f, fl)) return false;
      const c = new Date(f.created_at);
      return !isNaN(c) && c >= van;
    });
    const ingediend = rijen.filter(isIngediend);
    tekenKomend(fl);
    tekenTegels(rijen, ingediend, eersteRender);
    tekenPF(ingediend);
    tekenVerkopers(rijen);
    tekenVestigingen(rijen);
    tekenLaatste(rijen, eersteRender);
    eersteRender = false;
  }

  /* ---------- laden ---------- */
  async function laad() {
    const nr = ++bezig;
    laadStaat();
    const { data, error } = await rpcMetSessie("dashboard_formulieren");
    if (nr !== bezig) return;
    if (error) {
      ["d_komend", "d_tegels", "d_pf", "d_verkopers", "d_vestigingen", "d_laatste"].forEach(id => { $(id).innerHTML = ""; });
      $("d_fout").innerHTML = `<div class="melding let-op" style="margin-top:14px">Het dashboard kon niet worden geladen. ${esc(error.message || "")}
        <button type="button" class="knop-sec" id="d_opnieuw">Opnieuw</button></div>`;
      $("d_opnieuw").onclick = laad;
      return;
    }
    alle = Array.isArray(data) ? data : [];
    eersteRender = true;
    teken();
  }

  /* ---------- events ---------- */
  ["d_periode", "d_soort", "d_vestiging"].forEach(id => $(id).addEventListener("change", teken));
  const klik = e => {
    const el = e.target.closest("[data-id]");
    if (el) open(el.dataset.id);
  };
  $("d_komend").addEventListener("click", klik);
  $("d_laatste").addEventListener("click", klik);
  [$("d_komend"), $("d_laatste")].forEach(c => c.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.dataset && e.target.dataset.id) { e.preventDefault(); open(e.target.dataset.id); }
  }));

  await laad();
})();
