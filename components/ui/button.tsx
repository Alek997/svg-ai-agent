import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-stone-900 text-white hover:bg-stone-700",
    secondary:
      "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
    ghost: "text-stone-500 hover:bg-stone-100 hover:text-stone-900",
  };
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
