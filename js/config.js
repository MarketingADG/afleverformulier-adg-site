/* Verbinding met de database van dit project (Supabase oveguihjtreqxoavlmpw).

   De sleutel hieronder is de publieke ("publishable") sleutel. Die mag in de HTML staan:
   alle tabellen zijn dicht voor directe toegang, en alles loopt via databasefuncties die
   eerst het sessietoken controleren. Zonder geldig token levert de sleutel niets op.
   Zie docs/db/schema.sql. De geheime service-sleutel komt hier nooit. */
const AFLEVER_CONFIG = {
  url: "https://oveguihjtreqxoavlmpw.supabase.co",
  key: "VUL_IN"   /* publishable key, ophalen met de MCP-tool get_publishable_keys */
};
