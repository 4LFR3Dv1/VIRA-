import type { SupportedLocale } from "./locale.ts";

const PT_BR_TEAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  algeria: "Argélia", argentina: "Argentina", australia: "Austrália", austria: "Áustria",
  belgium: "Bélgica", brazil: "Brasil", canada: "Canadá", chile: "Chile", colombia: "Colômbia",
  croatia: "Croácia", denmark: "Dinamarca", ecuador: "Equador", egypt: "Egito", england: "Inglaterra",
  france: "França", germany: "Alemanha", ghana: "Gana", italy: "Itália", japan: "Japão",
  mexico: "México", morocco: "Marrocos", myanmar: "Mianmar", netherlands: "Países Baixos",
  norway: "Noruega", paraguay: "Paraguai", peru: "Peru", poland: "Polônia", portugal: "Portugal",
  scotland: "Escócia", senegal: "Senegal", serbia: "Sérvia", spain: "Espanha",
  switzerland: "Suíça", turkey: "Turquia", ukraine: "Ucrânia", "united states": "Estados Unidos",
  usa: "Estados Unidos", uruguay: "Uruguai", vietnam: "Vietnã", wales: "País de Gales",
  "new zealand": "Nova Zelândia", "south korea": "Coreia do Sul", korea: "Coreia do Sul",
  "saudi arabia": "Arábia Saudita", "costa rica": "Costa Rica", "south africa": "África do Sul",
  "ivory coast": "Costa do Marfim", "cote d ivoire": "Costa do Marfim", iran: "Irã", iraq: "Iraque",
  tunisia: "Tunísia", cameroon: "Camarões", nigeria: "Nigéria", panama: "Panamá", qatar: "Catar",
  romania: "Romênia", hungary: "Hungria", greece: "Grécia", sweden: "Suécia", finland: "Finlândia",
  iceland: "Islândia", ireland: "Irlanda", "northern ireland": "Irlanda do Norte", czechia: "Tchéquia",
  "czech republic": "Tchéquia", slovakia: "Eslováquia", slovenia: "Eslovênia", bosnia: "Bósnia",
  "bosnia and herzegovina": "Bósnia e Herzegovina", georgia: "Geórgia", albania: "Albânia",
});

function key(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function teamDisplayName(providerName: string, locale: SupportedLocale): string {
  const original = String(providerName ?? "").trim();
  if (!original || locale !== "pt-BR") return original;
  return PT_BR_TEAM_NAMES[key(original)] ?? original;
}
