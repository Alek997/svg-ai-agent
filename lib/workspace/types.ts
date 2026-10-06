export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// Model output must pass server XML validation before becoming a document.
export type SvgDocument = import("zod").z.infer<
  typeof import("./contracts").svgDocumentSchema
>;
