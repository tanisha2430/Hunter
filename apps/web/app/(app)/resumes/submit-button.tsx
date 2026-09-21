"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@hunter/ui";

/** For plain `<form action={...}>` submits with no client wrapper of their own. */
export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}
