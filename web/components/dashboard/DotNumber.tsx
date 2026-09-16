import { T } from "@/lib/design-tokens";

type Props = {
  value: string | number;
  size?: number;
  color?: string;
};

export default function DotNumber({ value, size = 52, color = "rgba(255,255,255,0.95)" }: Props) {
  return (
    <span
      style={{
        fontFamily: T.font.mono,
        fontSize: size,
        fontWeight: 400,
        color,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        textShadow: `0 0 20px ${color.replace("0.95", "0.5")}`,
      }}
    >
      {value}
    </span>
  );
}
