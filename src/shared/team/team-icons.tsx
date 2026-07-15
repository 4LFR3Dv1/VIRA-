import { useState } from "react";

const flagCodeByTeam: Record<string, string> = {
  algeria: "dz",
  argentina: "ar",
  australia: "au",
  austria: "at",
  belgium: "be",
  brazil: "br",
  canada: "ca",
  chile: "cl",
  colombia: "co",
  croatia: "hr",
  denmark: "dk",
  ecuador: "ec",
  egypt: "eg",
  england: "gb-eng",
  france: "fr",
  germany: "de",
  ghana: "gh",
  italy: "it",
  japan: "jp",
  mexico: "mx",
  morocco: "ma",
  myanmar: "mm",
  netherlands: "nl",
  norway: "no",
  paraguay: "py",
  peru: "pe",
  poland: "pl",
  portugal: "pt",
  scotland: "gb-sct",
  senegal: "sn",
  serbia: "rs",
  spain: "es",
  switzerland: "ch",
  turkey: "tr",
  ukraine: "ua",
  "united states": "us",
  usa: "us",
  uruguay: "uy",
  vietnam: "vn",
  wales: "gb-wls",
};

export function teamShortCode(name: string) {
  const clean = name.replace(/[^a-z0-9\s]/gi, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts
      .map((part) => part[0]?.toUpperCase())
      .join("")
      .slice(0, 3);
  }
  return clean.slice(0, 3).toUpperCase() || "FC";
}

function normalizeTeamName(name: string) {
  return name.trim().toLowerCase();
}

export function getTeamFlagCode(name: string) {
  return flagCodeByTeam[normalizeTeamName(name)] ?? null;
}

export function getTeamFlagUrl(name: string) {
  const code = getTeamFlagCode(name);
  return code ? `https://flagcdn.com/${code}.svg` : null;
}

interface TeamIconProps {
  name: string;
  side?: "home" | "away" | "neutral";
  size?: "sm" | "md" | "lg" | "xl";
}

export function TeamIcon({ name, side = "neutral", size = "md" }: TeamIconProps) {
  const [failed, setFailed] = useState(false);
  const flagUrl = failed ? null : getTeamFlagUrl(name);
  const wrapperClass = size === "xl" ? "h-12 w-[4.25rem]" : size === "lg" ? "h-10 w-14" : size === "sm" ? "h-5 w-7" : "h-7 w-10";
  const imageClass = "h-full w-full";
  const textReplacementClass = size === "xl" ? "text-xl" : size === "lg" ? "text-lg" : size === "sm" ? "text-[10px]" : "text-xs";
  const textReplacementTone = side === "away" ? "text-amber-200" : side === "home" ? "text-primary" : "text-foreground";

  return (
    <span
      className={`inline-grid shrink-0 place-items-center ${wrapperClass}`}
      aria-label={`${name} team icon`}
      title={name}
    >
      {flagUrl ? (
        <img
          alt={`${name} flag`}
          className={`${imageClass} object-contain`}
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={flagUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={`font-['Chakra_Petch'] font-black ${textReplacementClass} ${textReplacementTone}`}>{teamShortCode(name)}</span>
      )}
    </span>
  );
}
