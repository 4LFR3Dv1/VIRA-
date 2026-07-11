import NumberFlow, { useCanAnimate } from "@number-flow/react";
import { useEffect, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  locales?: Intl.LocalesArgument;
  format?: Intl.NumberFormatOptions;
}

export function AnimatedNumber({
  value,
  className,
  prefix,
  suffix,
  locales = "pt-BR",
  format,
}: AnimatedNumberProps) {
  const [mounted, setMounted] = useState(false);
  const canAnimate = useCanAnimate({ respectMotionPreference: true });

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <NumberFlow
      value={value}
      locales={locales}
      format={format}
      prefix={prefix}
      suffix={suffix}
      animated={mounted && canAnimate}
      respectMotionPreference
      willChange
      className={className}
    />
  );
}
