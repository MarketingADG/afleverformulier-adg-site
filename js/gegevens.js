/* Vaste gegevens die op meer pagina's nodig zijn: vestigingen en wie welke mail krijgt.
   Overgenomen uit het oorspronkelijke afleverformulier (test7.html, 2026-09-29).
   Wijzig je hier iets, loop dan de cc-test uit CLAUDE.md opnieuw door. */

const VESTIGINGEN = [
  "Assen", "Emmen", "Hoogeveen Toyota", "Hoogeveen Suzuki",
  "Groningen Toyota", "Groningen Lexus", "Veendam Toyota", "Veendam Suzuki"
];

/* Aan wie het ingediende formulier gaat. */
const ADMINISTRATIE_MAIL = "ca@adggroep.nl";

/* De verkoopleider die in cc gaat. In Groningen hangt dat af van nieuw of occasion;
   zonder die keuze is er daar nog geen verkoopleider en komt er een lege tekst terug. */
function verkoopleiderVoor(vestiging, soort) {
  if (vestiging === "Assen") return "svanweerlee@adggroep.nl";
  if (vestiging === "Emmen") return "jreuvers@adggroep.nl";
  if (vestiging === "Hoogeveen Toyota" || vestiging === "Hoogeveen Suzuki") return "lhulsebosch@adggroep.nl";
  if (vestiging === "Veendam Toyota" || vestiging === "Veendam Suzuki") return "cgillard@adggroep.nl";
  if (vestiging === "Groningen Toyota" || vestiging === "Groningen Lexus") {
    if (soort === "Nieuw") return "bbrons@adggroep.nl";
    if (soort === "Occasion") return "pveenhuizen@adggroep.nl";
  }
  return "";
}
