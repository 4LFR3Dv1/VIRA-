import { selectPluralCategory } from "../formatters.ts";
import type { TranslationCatalog } from "../translate.ts";

export const ptBR = {
  "locale.selectorLabel": "Idioma",
  "locale.currentLanguage": ({ language }) => `Idioma atual: ${language}`,
  "locale.option.en": "Inglês",
  "locale.option.ptBR": "Português",
  "common.loading": "Carregando",
  "common.retry": "Tentar novamente",
  "common.close": "Fechar",
  "common.back": "Voltar",
  "common.continue": "Continuar",
  "common.unavailable": "Indisponível",
  "common.genericError": "Algo deu errado.",
  "room.playersWaiting": ({ count }) => selectPluralCategory("pt-BR", count) === "one" ? "1 jogador aguardando" : `${count} jogadores aguardando`,
  "share.userPicked": ({ name, selection }) => `${name} escolheu ${selection}`,
} satisfies TranslationCatalog;
