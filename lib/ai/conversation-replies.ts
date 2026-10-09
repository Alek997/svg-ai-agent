import "server-only";

import { z } from "zod";

// Temporary solution: Decisions chooses an intent and language, then we return
// fixed copy. Natural, context-aware multilingual conversations would require a
// dedicated, bounded text-model call after classification, without SVG tools.
// To extend this catalog, add a language ID, criteria, and a complete translation.
const supportedLanguages = ["en", "sr_latn", "sr_cyrl"] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

export const replyLanguageSchema = z.enum([...supportedLanguages, "other"]);
type ReplyLanguage = z.infer<typeof replyLanguageSchema>;

export const replyLanguageCriteria = {
  en: "English, including an explicit preference to receive English replies.",
  sr_latn: "Serbian written in Latin script, including ASCII spellings such as cao, hvala, dovidjenja.",
  sr_cyrl: "Serbian written in Cyrillic script, such as ћао, хвала, довиђења.",
  other: "Another language, or insufficient evidence to choose a supported language. Reply in English.",
} satisfies Record<ReplyLanguage, string>;

type ConversationIntent = "greeting" | "thanks" | "farewell" | "acknowledge" | "clarify";
type ReplyCopy = Record<Exclude<ConversationIntent, "clarify"> | "clarifyCreate" | "clarifyEdit", string>;

const replies: Record<SupportedLanguage, ReplyCopy> = {
  en: {
    greeting: "Hi! How’s it going?",
    thanks: "You’re welcome! Glad you like it.",
    farewell: "Goodbye! Take care.",
    acknowledge: "Got it.",
    clarifyCreate: "What would you like the SVG to show?",
    clarifyEdit: "What would you like to change in the artwork?",
  },
  sr_latn: {
    greeting: "Ćao! Kako si?",
    thanks: "Nema na čemu! Drago mi je da ti se sviđa.",
    farewell: "Doviđenja! Sve najbolje.",
    acknowledge: "Važi.",
    clarifyCreate: "Šta želiš da SVG prikazuje?",
    clarifyEdit: "Šta želiš da promeniš na ilustraciji?",
  },
  sr_cyrl: {
    greeting: "Ћао! Како си?",
    thanks: "Нема на чему! Драго ми је да ти се свиђа.",
    farewell: "Довиђења! Све најбоље.",
    acknowledge: "Важи.",
    clarifyCreate: "Шта желиш да SVG приказује?",
    clarifyEdit: "Шта желиш да промениш на илустрацији?",
  },
};

export function getConversationReply(language: ReplyLanguage, intent: ConversationIntent, hasArtwork: boolean) {
  const copy = replies[language === "other" ? "en" : language];
  return intent === "clarify"
    ? copy[hasArtwork ? "clarifyEdit" : "clarifyCreate"]
    : copy[intent];
}
