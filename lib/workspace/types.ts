export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  excludedFromContext?: boolean;
  flow?: import("./flow").FlowEntry[];
  steps?: import("./contracts").StepTrace[];
  runStatus?: "running" | "completed" | "error";
  runError?: string;
  tools?: import("./contracts").ToolTrace[];
  usage?: import("./contracts").GenerationUsage;
  feedbackToken?: string;
};

// Model output must pass server XML validation before becoming a document.
export type SvgDocument = import("zod").z.infer<
  typeof import("./contracts").svgDocumentSchema
>;
