import type { CSSProperties, ReactNode } from "react";
import type { Tint } from "@/lib/design-tokens";

type Props = {
  tint?: Tint;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export default function Glass({ tint, className = "", style, children }: Props) {
  const tintClass = tint ? `glass-tint-${tint}` : "";
  return (
    <div className={`glass ${tintClass} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
