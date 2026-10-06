import type { SVGProps } from "react";

const paths = {
  sparkles: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z",
  arrow: "M12 19V5m-5 5 5-5 5 5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  download: "M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  canvas: "M4 4h16v16H4zM4 8h16M8 8v12",
  reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
  chat: "M4 4h16v13H9l-5 4V4Z",
} satisfies Record<string, string>;

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
