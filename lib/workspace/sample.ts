import type { SvgDocument } from "./types";

export const sampleDocument: SvgDocument = {
  name: "little-landscape.svg",
  description: "An example landscape with a warm sun and layered green hills",
  width: 480,
  height: 360,
  source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" width="480" height="360">
  <rect width="480" height="360" rx="24" fill="#f7f3ea"/>
  <circle cx="326" cy="108" r="39" fill="#e7b875"/>
  <path d="M94 128h56m-28-12h54" fill="none" stroke="#e4dfd3" stroke-width="8" stroke-linecap="round"/>
  <path d="M0 265 130 137 271 281 369 194 480 287v73H0Z" fill="#a7b6a0"/>
  <path d="m0 312 175-108 147 105 158-60v111H0Z" fill="#6b8976"/>
  <path d="M0 338c116-73 198-27 270-16s134-7 210-28v66H0Z" fill="#3c6254"/>
</svg>`,
};
