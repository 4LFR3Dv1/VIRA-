import { resolveShareLocaleContext, shareKindLabel } from "../shared/share-copy.mjs";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function copy(locale) {
  return locale === "en" ? {
    reassurance: "Join instantly — no account, X, wallet or installation.", how: "How VIRA works", steps: ["Join your friends", "Answer before the server clock locks", "Resolve and rank together"], powered: "Sports data and match authority powered by TxLINE.", imageAlt: "VIRA share card", open: "Open VIRA",
  } : {
    reassurance: "Entre na hora — sem conta, X, wallet ou instalação.", how: "Como o VIRA funciona", steps: ["Entre com seus amigos", "Responda antes do relógio do servidor fechar", "Veja resultado e ranking juntos"], powered: "Dados esportivos e autoridade da partida fornecidos pela TxLINE.", imageAlt: "Card compartilhável do VIRA", open: "Abrir VIRA",
  };
}

export function renderSharePage({ share, base }) {
  const localeContext = resolveShareLocaleContext(share);
  const strings = copy(localeContext.locale);
  const title = escapeHtml(share.metadata.title);
  const description = escapeHtml(share.metadata.description);
  const image = `${base}/share-images/${encodeURIComponent(share.publicCode)}.png`;
  const canonicalUrl = `${base}/s/${encodeURIComponent(share.publicCode)}`;
  const destinationUrl = new URL(share.destination.path, base);
  destinationUrl.searchParams.set("invite", share.publicCode);
  destinationUrl.searchParams.set("lang", localeContext.locale);
  const destination = escapeHtml(`${destinationUrl.pathname}${destinationUrl.search}${destinationUrl.hash}`);
  const kind = escapeHtml(shareKindLabel(share.kind, localeContext.locale));
  const cta = escapeHtml(share.destination.ctaLabel || strings.open);
  const steps = strings.steps.map((step, index) => `<li style="display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start"><span style="color:#C8FF00;font:800 11px monospace">0${index + 1}</span><span>${escapeHtml(step)}</span></li>`).join("");
  return `<!doctype html><html lang="${localeContext.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:site_name" content="VIRA"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${image}"><meta property="og:image:secure_url" content="${image}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${canonicalUrl}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${image}"><meta name="theme-color" content="#050A12"><link rel="icon" href="/favicon.ico"><style>*{box-sizing:border-box}body{margin:0;background:#050A12;color:#F5F7F2;font-family:Arial,sans-serif}main{min-height:100vh;padding:24px}.shell{width:min(1120px,100%);margin:auto}.brand{height:48px;width:auto}.card{display:grid;gap:28px;margin-top:30px}.preview{width:100%;height:auto;border:1px solid #ffffff24}.copy{padding:6px 0 36px}.kind{color:#C8FF00;font:800 10px monospace;letter-spacing:.18em}.title{font-size:clamp(38px,7vw,76px);line-height:.88;text-transform:uppercase;margin:18px 0}.description{color:#F5F7F299;font-size:17px;line-height:1.55}.cta{display:flex;justify-content:space-between;align-items:center;margin-top:26px;min-height:58px;background:#C8FF00;color:#050A12;padding:0 22px;font-weight:900;text-transform:uppercase;text-decoration:none}.reassure{margin-top:14px;color:#F5F7F28A;font-size:13px}.how{border-top:1px solid #ffffff24;padding-top:24px}.how h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em}.how ol{display:grid;gap:13px;padding:0;list-style:none;color:#F5F7F2B8;font-size:14px}.source{border-top:1px solid #ffffff18;padding:20px 0;color:#F5F7F266;font:11px monospace;letter-spacing:.05em}@media(min-width:900px){main{display:grid;place-items:center}.card{grid-template-columns:minmax(0,1.25fr) minmax(330px,.75fr);align-items:start}.copy{position:sticky;top:24px}}</style></head><body><main><div class="shell"><img class="brand" src="/vira-icon.png" alt="VIRA"><section class="card"><div><img class="preview" src="${image}" alt="${escapeHtml(strings.imageAlt)}" width="1200" height="630"></div><div class="copy"><p class="kind">VIRA · ${kind}</p><h1 class="title">${title}</h1><p class="description">${description}</p><a href="${destination}" data-share-cta class="cta"><span>${cta}</span><span aria-hidden="true">→</span></a><p class="reassure">${escapeHtml(strings.reassurance)}</p><div class="how"><h2>${escapeHtml(strings.how)}</h2><ol>${steps}</ol></div></div></section><footer class="source">${escapeHtml(strings.powered)}</footer></div></main><script>document.querySelector('[data-share-cta]').addEventListener('click',()=>{navigator.sendBeacon('/shares/${encodeURIComponent(share.publicCode)}/click')})</script></body></html>`;
}
