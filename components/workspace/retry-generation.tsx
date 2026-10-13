"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function RetryGeneration({
  availableAt,
  disabled,
  onRetry,
}: {
  availableAt: number;
  disabled: boolean;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const seconds = Math.max(0, Math.ceil((availableAt - now) / 1000));
  useEffect(() => {
    if (availableAt <= Date.now()) return;
    const interval = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= availableAt) clearInterval(interval);
    }, 250);
    return () => clearInterval(interval);
  }, [availableAt]);
  return (
    <Button
      onClick={() => {
        if (Date.now() >= availableAt) onRetry();
      }}
      disabled={disabled || seconds > 0}
      className="mt-2"
    >
      {seconds > 0 ? `Retry in ${seconds}s` : "Retry generation"}
    </Button>
  );
}
