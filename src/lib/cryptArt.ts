import { CRYPT } from './cryptKit';
import type { CryptKind } from './types';

const DEFS = `<defs>
<linearGradient id="wood" x2=".2" y2="1"><stop stop-color="#8d5f37"/><stop offset=".45" stop-color="#6b4526"/><stop offset="1" stop-color="#3d2515"/></linearGradient>
<linearGradient id="woodLight" x2=".2" y2="1"><stop stop-color="#c09256"/><stop offset=".45" stop-color="#95633a"/><stop offset="1" stop-color="#5b3820"/></linearGradient>
<linearGradient id="stoneG" x2=".3" y2="1"><stop stop-color="#b3ac96"/><stop offset=".45" stop-color="#8a8471"/><stop offset="1" stop-color="#4f4c41"/></linearGradient>
<linearGradient id="ironG" x2=".3" y2="1"><stop stop-color="#9aa093"/><stop offset=".45" stop-color="#666a5f"/><stop offset="1" stop-color="#33372f"/></linearGradient>
<linearGradient id="boneG" x2=".3" y2="1"><stop stop-color="#eee6cd"/><stop offset=".5" stop-color="#c3b795"/><stop offset="1" stop-color="#8e8365"/></linearGradient>
<linearGradient id="brassG" x2=".3" y2="1"><stop stop-color="#e3c07a"/><stop offset=".5" stop-color="#b08a45"/><stop offset="1" stop-color="#6d5228"/></linearGradient>
<linearGradient id="clothG" x2=".3" y2="1"><stop stop-color="#8d3f3c"/><stop offset=".5" stop-color="#6c2f2f"/><stop offset="1" stop-color="#3d1c1e"/></linearGradient>
<linearGradient id="clayG" x2=".3" y2="1"><stop stop-color="#b98a5e"/><stop offset=".5" stop-color="#8e5f3c"/><stop offset="1" stop-color="#573722"/></linearGradient>
<radialGradient id="glowG"><stop stop-color="#a7e3d2" stop-opacity=".9"/><stop offset="1" stop-color="#2c6f66" stop-opacity="0"/></radialGradient>
<radialGradient id="emberG"><stop stop-color="#ffd88a"/><stop offset=".5" stop-color="#d07a2e"/><stop offset="1" stop-color="#7a3312"/></radialGradient>
</defs>`;

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${DEFS}<g stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`)}`;
const shadow = `<ellipse cx="50" cy="82" rx="33" ry="8" fill="#12100c" opacity=".38"/>`;
const stroke = '#33291f';

const box = (x: number, y: number, w: number, h: number, fill: string, r = 3, sw = 3) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const plank = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#woodLight)" stroke="${stroke}" stroke-width="2.4"/><path d="M${x + 4} ${y + h * .34}h${w - 8}M${x + 4} ${y + h * .68}h${w - 8}" stroke="#4c3320" stroke-width="1.5" fill="none"/>`;

const crates = (rows: number) => {
  let body = '';
  for (let i = 0; i < rows; i++) {
    const y = 74 - i * 25, x = 24 + (i % 2) * 6;
    body += plank(x, y, 48, 24) + `<path d="M${x + 4} ${y + 4}l40 16M${x + 44} ${y + 4}l-40 16" stroke="#4a3020" stroke-width="1.6" fill="none"/>`;
  }
  return body;
};
const barrels = (rows: number) => {
  let body = '';
  for (let i = 0; i < rows; i++) {
    const y = 78 - i * 34, x = 28 + (i % 2) * 8;
    body += `<ellipse cx="${x + 22}" cy="${y}" rx="22" ry="9" fill="url(#wood)" stroke="${stroke}" stroke-width="2.6"/><path d="M${x} ${y}v22M${x + 44} ${y}v22" stroke="#4a3020" stroke-width="2"/><ellipse cx="${x + 22}" cy="${y + 22}" rx="22" ry="8" fill="#6d4826" stroke="${stroke}" stroke-width="2.6"/><path d="M${x + 3} ${y + 8}h38M${x + 3} ${y + 15}h38" stroke="#8d8b78" stroke-width="2.6"/>`;
  }
  return body;
};
const boneSkull = (x: number, y: number, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 12a11 9 0 1 1 22 0c0 4-3 6-5 7v5h-4v-4h-4v4H5v-5c-2-1-5-3-5-7z" fill="url(#boneG)" stroke="${stroke}" stroke-width="2.2"/><circle cx="7" cy="11" r="3" fill="#3b352a"/><circle cx="15" cy="11" r="3" fill="#3b352a"/><path d="M10 16h2" stroke="#3b352a" stroke-width="1.6"/></g>`;
const boneRib = (x: number, y: number, n = 4) => {
  let body = '';
  for (let i = 0; i < n; i++) body += `<path d="M${x} ${y + i * 7}q11 5 22 0" fill="none" stroke="url(#boneG)" stroke-width="3.4" stroke-linecap="round"/>`;
  return body;
};
const candle = (x: number, y: number, h = 20) =>
  `<rect x="${x - 3}" y="${y - h}" width="6" height="${h}" rx="2" fill="#e2d6b8" stroke="${stroke}" stroke-width="1.8"/><ellipse cx="${x}" cy="${y - h - 3}" rx="3" ry="4.6" fill="#f5c45e" stroke="#a8721f" stroke-width="1.4"/>`;
const flame = (x: number, y: number) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="9" fill="url(#emberG)"/><ellipse cx="${x}" cy="${y + 2}" rx="3" ry="5" fill="#ffe9ab"/>`;
const rubblePile = (n = 6) => {
  let body = '';
  for (let i = 0; i < n; i++) {
    const x = 16 + (i * 17) % 62, y = 58 + ((i * 23) % 22);
    body += `<path d="M${x} ${y}l9-7 8 9-7 8-10-6z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="2.4"/>`;
  }
  return body;
};
const iron = (x: number, y: number, w: number, h: number) => box(x, y, w, h, 'url(#ironG)', 4, 3);
const crate = (x: number, y: number, w = 44, h = 34, open = false) =>
  plank(x, y, w, h) + `<path d="M${x + 4} ${y + 4}l${w - 8} ${h - 8}M${x + w - 4} ${y + 4}l${-(w - 8)} ${h - 8}" stroke="#4a3020" stroke-width="1.6" fill="none"/>` +
  (open ? `<path d="M${x + 3} ${y + 2}l${w - 6} -12" stroke="#4a3020" stroke-width="4"/>` : '');

export function cryptArtSvg(kind: CryptKind): string {
  const s = (body: string) => svg(shadow + body);
  switch (kind) {
    // ---------------- опасности ----------------
    case 'chasm': return s(`<path d="M2 42 16 20l16 12 16-16 16 22 18-8 16 16v26H0Z" fill="#2a2622" stroke="${stroke}" stroke-width="3"/><path d="M6 44 18 26l14 12 16-14 16 20 16-6 14 14v18H6Z" fill="#15171c"/><path d="M14 78q22-10 44-2t32-6" fill="none" stroke="#3f5a58" stroke-width="3" stroke-opacity=".8"/>`);
    case 'pit': return s(`<ellipse cx="50" cy="58" rx="30" ry="20" fill="#1b1a1d" stroke="#6b6459" stroke-width="4"/><ellipse cx="50" cy="58" rx="20" ry="12" fill="#0d0e12"/><path d="M22 62q28 12 56 0" fill="none" stroke="#4c5c59" stroke-width="2.4"/>`);
    case 'sinkhole': return s(`<ellipse cx="50" cy="56" rx="36" ry="24" fill="#26221f" stroke="#6b6459" stroke-width="5"/><ellipse cx="50" cy="56" rx="26" ry="16" fill="#0e0f13"/><path d="M14 60q36 14 72 0" fill="none" stroke="#3d5b58" stroke-width="3"/>`);
    case 'grate': return s(iron(18, 26, 64, 52) + [0, 1, 2, 3, 4].map((i) => `<path d="M${26 + i * 13} 30v44" stroke="#a3a795" stroke-width="3"/>`).join('') + `<path d="M22 52h56" stroke="#a3a795" stroke-width="3"/>`);
    case 'sewerGrate': return s(iron(12, 34, 76, 40) + [0, 1, 2, 3, 4, 5].map((i) => `<path d="M${18 + i * 12} 38v32" stroke="#8d9284" stroke-width="2.6"/>`).join('') + `<path d="M40 20v14m20-14v14" stroke="#6b6f60" stroke-width="3"/>`);
    case 'drain': return s(iron(30, 40, 40, 34) + [0, 1, 2].map((i) => `<path d="M${36 + i * 11} 44v26" stroke="#9aa093" stroke-width="3"/>`).join(''));
    case 'bridge': return s(`<path d="M8 44h84v10H8z" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M14 40v18m18-18v18m18-18v18m18-18v18m18-18v18" stroke="#4c3320" stroke-width="3"/><path d="M8 34h84v8H8z" fill="#6d4826" stroke="${stroke}" stroke-width="2.4"/>`);
    case 'spikes': return s([0, 1, 2, 3].map((i) => `<path d="M${20 + i * 20} 78 30 24l10 54z" fill="#b9c0bb" stroke="${stroke}" stroke-width="2.4"/>`).join(''));
    case 'spikeGlyph': return s(`<rect x="22" y="22" width="56" height="56" rx="6" fill="#3c3a33" stroke="#c98d5f" stroke-width="2.4"/><path d="m30 68 10-34 10 34m0-40 10 40 10-40" fill="none" stroke="#d6a06a" stroke-width="3.4"/>`);
    case 'pressureTile': return s(`<rect x="20" y="20" width="60" height="60" rx="5" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><circle cx="50" cy="50" r="15" fill="none" stroke="#b8763f" stroke-width="3.4" stroke-dasharray="5 4"/><path d="M50 34v9m0 14v.1" stroke="#e0a76a" stroke-width="3.6"/>`);
    case 'runeTrap': return s(`<circle cx="50" cy="52" r="28" fill="#4a3f45" stroke="#c07a63" stroke-width="3"/><path d="m50 26 22 26-22 26-22-26z" fill="none" stroke="#e0a08a" stroke-width="3"/><path d="M50 38v28m-13-14h26" stroke="#e0a08a" stroke-width="2.6"/>`);
    case 'fallSeal': return s(`<rect x="18" y="18" width="64" height="64" rx="4" fill="#413b34" stroke="#7d7461" stroke-width="3"/><path d="M22 22h56v56H22z" fill="none" stroke="#a9a081" stroke-width="2.4" stroke-dasharray="7 5"/><path d="m34 34 32 32M66 34 34 66" stroke="#8d4b3f" stroke-width="3"/>`);
    case 'tripwire': return s(`<path d="M10 54h80" stroke="#c9c2ab" stroke-width="2"/><path d="M50 54v-8m0 0-7 8m7-8 7 8" fill="none" stroke="#9aa093" stroke-width="2.4"/><circle cx="14" cy="54" r="4" fill="#6f7266" stroke="${stroke}" stroke-width="2"/><circle cx="86" cy="54" r="4" fill="#6f7266" stroke="${stroke}" stroke-width="2"/>`);
    case 'dartHole': return s(`<rect x="30" y="26" width="40" height="18" rx="4" fill="#1b1a18" stroke="#6b6459" stroke-width="3"/><path d="M40 44v10m20-10v10" stroke="#a7a396" stroke-width="3"/><path d="m40 44-4 10m4-10 4 10M60 44l-4 10m4-10 4 10" stroke="#b7b0a0" stroke-width="2.4"/>`);
    case 'dartWall': return s(`<rect x="22" y="24" width="56" height="52" rx="4" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><circle cx="38" cy="42" r="6" fill="#1b1a18"/><circle cx="62" cy="42" r="6" fill="#1b1a18"/><circle cx="38" cy="64" r="6" fill="#1b1a18"/><circle cx="62" cy="64" r="6" fill="#1b1a18"/>`);
    case 'swingingBlade': return s(`<path d="M50 8v22" stroke="#7d8274" stroke-width="3"/><circle cx="50" cy="12" r="4" fill="#9aa093" stroke="${stroke}" stroke-width="2"/><path d="M50 30 60 66 50 78 40 66z" fill="#c3c8c2" stroke="${stroke}" stroke-width="2.6"/><path d="M50 34v34" stroke="#8d9287" stroke-width="1.8"/>`);
    case 'trapNet': return s(`<path d="M14 22h72v52H14z" fill="none" stroke="#b8b09a" stroke-width="2.6" stroke-dasharray="6 5"/><path d="M14 22 86 74M86 22 14 74M50 22v52" stroke="#a49c86" stroke-width="1.8"/><path d="M14 74h72" stroke="#7f7457" stroke-width="3.4"/>`);
    case 'poisonVent': return s(iron(26, 44, 48, 30) + [0, 1, 2].map((i) => `<path d="M${34 + i * 13} 48v22" stroke="#8d9284" stroke-width="2.6"/>`).join('') + `<path d="M34 30q8-8 16 0t16 0" fill="none" stroke="#7fa07a" stroke-width="3" stroke-opacity=".7"/>`);
    case 'falseDoor': return s(`<rect x="26" y="16" width="48" height="68" rx="3" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><circle cx="64" cy="50" r="3.4" fill="url(#brassG)" stroke="${stroke}" stroke-width="1.6"/><path d="M36 22v56m28-56v56" stroke="#4a3020" stroke-width="2.4"/>`);
    case 'illusoryWall': return s(`<rect x="22" y="18" width="56" height="64" rx="3" fill="#4a4a44" stroke="#8d8b78" stroke-width="3" stroke-dasharray="8 6"/><path d="M34 30h32M34 42h32M34 54h32M34 66h32" stroke="#7d7a68" stroke-width="2.2"/>`);
    case 'crushBlock': return s(`<rect x="24" y="14" width="52" height="30" rx="3" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><path d="M30 44v26m40-26v26" stroke="#6e6a5c" stroke-width="4"/><path d="M36 52h28" stroke="#9a947f" stroke-width="3"/>`);
    case 'pitTrap': return s(`<rect x="18" y="26" width="64" height="48" rx="4" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M30 26l10 48m30-48L60 74" stroke="#4a3020" stroke-width="3"/><circle cx="50" cy="50" r="5" fill="#9aa093" stroke="${stroke}" stroke-width="2"/>`);
    case 'crackedFloor': return s(`<rect x="14" y="14" width="72" height="72" rx="4" fill="#4f4b40" stroke="#6e6a5b" stroke-width="2.6"/><path d="M30 20 44 40 36 60 52 84M70 26 58 46 66 66" fill="none" stroke="#26241f" stroke-width="3"/><path d="M32 22 46 40" stroke="#8b8571" stroke-width="1.4"/>`);
    case 'collapse': return s(rubblePile(9) + `<path d="M22 46h56" stroke="#4a463c" stroke-width="3"/>`);
    case 'rockFall': return s(`<path d="M28 74 34 30l14-8 16 14 6 38z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><path d="M40 44l12-8 8 10" fill="none" stroke="#6e6a5b" stroke-width="2.4"/>`);
    case 'rubblePile': return s(rubblePile(7));
    case 'bearTrap': return s(`<circle cx="50" cy="52" r="26" fill="none" stroke="#8f9284" stroke-width="4"/><path d="M50 26v26m0 0 22 12m-22-12L28 64" stroke="#a7a396" stroke-width="4"/><circle cx="50" cy="52" r="5" fill="#c3c0ad" stroke="${stroke}" stroke-width="2"/>`);
    case 'snareRope': return s(`<ellipse cx="50" cy="54" rx="26" ry="16" fill="none" stroke="#c0a878" stroke-width="4"/><path d="M50 38v22" stroke="#8d7448" stroke-width="3"/><circle cx="50" cy="38" r="4" fill="#6f7266" stroke="${stroke}" stroke-width="2"/>`);
    case 'swingingLog': return s(`<path d="M50 10v16" stroke="#7d8274" stroke-width="3"/><rect x="16" y="26" width="68" height="20" rx="9" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M28 30v12m14-12v12m14-12v12" stroke="#4c3320" stroke-width="2.4"/>`);
    case 'boneSnare': return s(boneSkull(28, 44, .8) + `<path d="M56 60q12 6 22-4" fill="none" stroke="url(#boneG)" stroke-width="4"/><circle cx="50" cy="70" r="4" fill="#d8cfae" stroke="${stroke}" stroke-width="1.8"/>`);
    case 'mineRails': return s(`<path d="M22 26h56M22 74h56" stroke="#7f7457" stroke-width="4"/><path d="M28 26v48m20-48v48m20-48v48" stroke="#5b4f39" stroke-width="4"/><path d="M18 40h64M18 60h64" stroke="#6b6152" stroke-width="3"/>`);

    // ---------------- погребение ----------------
    case 'skull': return s(boneSkull(38, 38, 1));
    case 'ribcage': return s(boneRib(30, 40, 5) + `<path d="M40 72h30" stroke="url(#boneG)" stroke-width="4"/>`);
    case 'pelvis': return s(`<path d="M32 46q18-8 36 0l-6 22-12 4-12-4z" fill="url(#boneG)" stroke="${stroke}" stroke-width="2.6"/><circle cx="42" cy="56" r="5" fill="#3b352a"/><circle cx="58" cy="56" r="5" fill="#3b352a"/>`);
    case 'spine': return s([0, 1, 2, 3, 4, 5].map((i) => `<rect x="${40 + (i % 2 ? 4 : 0)}" y="${24 + i * 9}" width="16" height="7" rx="3" fill="url(#boneG)" stroke="${stroke}" stroke-width="1.8"/>`).join(''));
    case 'femurs': return s([0, 1, 2].map((i) => `<path d="M${26 + i * 18} 74q6-16 4-28" fill="none" stroke="url(#boneG)" stroke-width="6" stroke-linecap="round"/><circle cx="${30 + i * 18}" cy="44" r="5" fill="url(#boneG)" stroke="${stroke}" stroke-width="2"/>`).join(''));
    case 'jaw': return s(`<path d="M28 48q22 18 44 0l-6 14q-16 10-32 0z" fill="url(#boneG)" stroke="${stroke}" stroke-width="2.6"/><path d="M36 52v8m10-6v8m10-10v8" stroke="#8e8365" stroke-width="2"/>`);
    case 'bonePile': return s(rubblePile(4) + boneSkull(58, 34, .7));
    case 'skeletonPile': return s(boneSkull(30, 30, .8) + boneSkull(52, 44, .7) + boneRib(34, 58, 3));
    case 'corpse': return s(`<path d="M18 58q22-16 44-6l20 12-4 14-30-4-30 8z" fill="#8e8570" stroke="${stroke}" stroke-width="2.6"/><circle cx="26" cy="52" r="10" fill="#9a917b" stroke="${stroke}" stroke-width="2.4"/>`);
    case 'wrappedBody': return s(`<path d="M22 44q28-10 56 6l-4 30-24 4-28-8z" fill="#cfc6ac" stroke="${stroke}" stroke-width="2.6"/><path d="M30 52q20 6 40 2M32 64q18 5 34 1" fill="none" stroke="#9c937a" stroke-width="2.4"/>`);
    case 'graveDirt': return s(`<path d="M14 74q36-34 72 0z" fill="#5b4b39" stroke="${stroke}" stroke-width="2.6"/><path d="M26 70q24-20 48 0" fill="none" stroke="#7a664e" stroke-width="2.4"/>`);
    case 'graveStone': return s(`<path d="M32 74V38q18-10 36 0v36z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><path d="M44 62h12m-12-10h12m-12-10h12" stroke="#6e6a5b" stroke-width="2.6"/>`);
    case 'nameTomb': return s(`<path d="M30 74V40q20-12 40 0v34z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><path d="M42 64h16m-16-9h16m-16-9h16" stroke="#5f5c50" stroke-width="2.4"/>`);
    case 'tomb': return s(box(16, 34, 68, 40, 'url(#stoneG)', 4) + `<path d="M26 46h48M26 58h48" stroke="#6e6a5b" stroke-width="2.4"/><path d="M22 30q28-10 56 0" fill="none" stroke="#8a8471" stroke-width="3"/>`);
    case 'mausoleum': return s(box(14, 22, 72, 56, 'url(#stoneG)', 4) + `<path d="M14 34h72M34 34v44m32-44v44" stroke="#5f5c50" stroke-width="2.6"/><path d="M24 22 50 8l26 14z" fill="#7f7967" stroke="${stroke}" stroke-width="2.6"/>`);
    case 'burialNiche': return s(`<path d="M26 74V40q24-14 48 0v34z" fill="#2e2b26" stroke="#7c7565" stroke-width="3"/><path d="M34 74V46q16-9 32 0v28z" fill="#4a463c"/>`);
    case 'ossuaryShelf': return s(box(20, 28, 60, 44, 'url(#wood)', 3) + `<path d="M24 50h52" stroke="#4a3020" stroke-width="3"/>${boneSkull(32, 32, .5)}${boneSkull(50, 32, .5)}${boneSkull(66, 32, .45)}`);
    case 'catacombArch': return s(`<path d="M22 76V46q28-28 56 0v30h-12V48q-16-16-32 0v28z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/>`);
    case 'cryptPodium': return s(box(24, 34, 52, 40, 'url(#stoneG)', 3) + `<path d="M18 34h64v8H18z" fill="#9a9481" stroke="${stroke}" stroke-width="2.4"/><path d="M32 48h36M32 60h36" stroke="#6e6a5b" stroke-width="2"/>`);
    case 'sarcophagusLid': return s(box(10, 40, 80, 26, 'url(#stoneG)', 3) + `<path d="M20 46h60M20 58h60" stroke="#6e6a5b" stroke-width="2.2"/><circle cx="50" cy="53" r="8" fill="none" stroke="#7f7967" stroke-width="2.4"/>`);
    case 'coffinLid': return s(plank(8, 36, 84, 28) + `<path d="M16 42h68M16 56h68" stroke="#4c3320" stroke-width="2.4"/><path d="M46 38v24M56 38v24" stroke="#3a2717" stroke-width="3"/>`);
    case 'wreath': return s(`<circle cx="50" cy="52" r="24" fill="none" stroke="#6f7a45" stroke-width="7" stroke-dasharray="7 4"/><circle cx="50" cy="52" r="24" fill="none" stroke="#8b9455" stroke-width="2.4"/><path d="M50 28v48M26 52h48" stroke="#5d6839" stroke-width="2.4"/>`);
    case 'graveCandle': return s(candle(50, 74, 22) + flame(50, 46) + `<ellipse cx="50" cy="76" rx="10" ry="4" fill="#5b4b39" stroke="${stroke}" stroke-width="1.8"/>`);
    case 'pyre': return s(`<path d="M22 74 44 34l10 22 12-26 14 44z" fill="#4a3a2c" stroke="${stroke}" stroke-width="2.6"/><path d="M36 70 48 44m8 26 6-20" stroke="#8a6a42" stroke-width="3"/>`);
    case 'burialUrn': return s(`<path d="M36 28h28l-4 12q12 14 6 30H34q-6-16 6-30z" fill="url(#clayG)" stroke="${stroke}" stroke-width="2.6"/><rect x="34" y="22" width="32" height="7" rx="2" fill="#6f472c" stroke="${stroke}" stroke-width="2"/>`);
    case 'reliquaryUrn': return s(`<path d="M36 26h28l-4 12q12 14 6 32H34q-6-18 6-32z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.6"/><rect x="33" y="20" width="34" height="7" rx="2" fill="#8f6f38" stroke="${stroke}" stroke-width="2"/><circle cx="50" cy="50" r="7" fill="#4f8f88" stroke="#cfe6d9" stroke-width="2"/>`);
    case 'mournerStatue': return s(`<path d="M36 74V44q14-12 28 0v30z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><circle cx="50" cy="34" r="12" fill="#9a9481" stroke="${stroke}" stroke-width="2.6"/><path d="M42 74V58q8-6 16 0v16" fill="#7f7967" stroke="${stroke}" stroke-width="2.4"/>`);

    // ---------------- реликвии ----------------
    case 'pedestal': return s(box(30, 30, 40, 44, 'url(#stoneG)', 3) + `<path d="M22 30h56v8H22zM26 74h48v-6H26z" fill="#9a9481" stroke="${stroke}" stroke-width="2.2"/>`);
    case 'idol': return s(`<path d="M32 74 36 34q14-12 28 0l4 40z" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><circle cx="50" cy="28" r="10" fill="#7c5735" stroke="${stroke}" stroke-width="2.6"/><path d="M44 30l4 4m8-4-4 4" stroke="#e0c98f" stroke-width="2.4"/><path d="M40 52h20M42 62h16" stroke="#3a2717" stroke-width="2.4"/>`);
    case 'obelisk': return s(`<path d="M40 76 44 20h12l4 56z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><path d="M46 34h8m-8 12h8m-8 12h8" stroke="#6e6a5b" stroke-width="2.2"/>`);
    case 'shrine': return s(box(28, 24, 44, 52, 'url(#stoneG)', 4) + `<path d="M38 24v-8h24v8" fill="#7f7967" stroke="${stroke}" stroke-width="2.4"/><circle cx="50" cy="46" r="10" fill="#2c2924" stroke="#c9a86a" stroke-width="2.4"/><path d="M50 38v16m-8-8h16" stroke="#e2c07e" stroke-width="2.2"/>`);
    case 'offeringBowl': return s(`<path d="M22 56h56q-6 18-28 18T22 56z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.8"/><ellipse cx="50" cy="56" rx="28" ry="8" fill="#d9b06a" stroke="${stroke}" stroke-width="2.4"/><circle cx="42" cy="54" r="4" fill="#a9c07a"/><circle cx="58" cy="55" r="5" fill="#b4584a"/>`);
    case 'chalice': return s(`<path d="M36 26h28q-2 20-14 24 12-4-14-24z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.6"/><path d="M50 50v16" stroke="#8f6f38" stroke-width="5"/><ellipse cx="50" cy="72" rx="15" ry="5" fill="#8f6f38" stroke="${stroke}" stroke-width="2.2"/>`);
    case 'goblet': return s(`<path d="M34 28h32q-3 24-16 26-13-2-16-26z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.6"/><path d="M50 54v14" stroke="#a98244" stroke-width="4"/><ellipse cx="50" cy="72" rx="17" ry="6" fill="#a98244" stroke="${stroke}" stroke-width="2.2"/><circle cx="50" cy="38" r="6" fill="#4f8f88" stroke="#d7e8da" stroke-width="1.8"/>`);
    case 'mask': return s(`<path d="M32 28q18-8 36 0l-4 34q-14 12-28 0z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.8"/><circle cx="42" cy="42" r="4" fill="#3b352a"/><circle cx="58" cy="42" r="4" fill="#3b352a"/><path d="M42 54q8 6 16 0" fill="none" stroke="#3b352a" stroke-width="2.4"/>`);
    case 'templeMask': return s([0, 1, 2].map((i) => `<g transform="translate(${20 + i * 21} ${36 + (i % 2) * 6})"><path d="M0 0q7-3 14 0l-1 13q-6 5-12 0z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2"/><circle cx="4.5" cy="5" r="1.8" fill="#3b352a"/><circle cx="9.5" cy="5" r="1.8" fill="#3b352a"/></g>`).join(''));
    case 'banner': return s(`<path d="M30 14h40v54l-20-10-20 10z" fill="url(#clothG)" stroke="${stroke}" stroke-width="2.8"/><path d="M50 26v20m-9-10h18" stroke="#d8c48c" stroke-width="2.6"/><path d="M28 14h44" stroke="#8a8471" stroke-width="3.4"/>`);
    case 'tapestry': return s(`<rect x="24" y="16" width="52" height="62" rx="2" fill="url(#clothG)" stroke="${stroke}" stroke-width="2.8"/><path d="M30 24h40v46H30z" fill="none" stroke="#d3b978" stroke-width="2.4"/><path d="m50 30 12 18-12 18-12-18z" fill="none" stroke="#e2cd94" stroke-width="2.4"/>`);
    case 'curtain': return s(`<path d="M24 12h52v64q-14-12-26 0-12-12-26 0z" fill="url(#clothG)" stroke="${stroke}" stroke-width="2.8"/><path d="M36 12v64M50 12v64M64 12v64" stroke="#5d2628" stroke-width="2"/>`);
    case 'mirror': return s(`<path d="M34 20h32v46q-16 10-32 0z" fill="#5f6b66" stroke="url(#brassG)" stroke-width="4"/><path d="M40 26h20v34q-10 6-20 0z" fill="#9fb3ac" stroke="${stroke}" stroke-width="2"/><path d="M44 30 42 54" stroke="#e6f0e6" stroke-width="2.4" stroke-opacity=".7"/>`);
    case 'orrery': return s(`<circle cx="50" cy="46" r="24" fill="none" stroke="url(#brassG)" stroke-width="3"/><ellipse cx="50" cy="46" rx="24" ry="9" fill="none" stroke="#c9a86a" stroke-width="2"/><ellipse cx="50" cy="46" rx="9" ry="24" fill="none" stroke="#c9a86a" stroke-width="2"/><circle cx="50" cy="46" r="6" fill="#e0c07a" stroke="${stroke}" stroke-width="1.8"/><path d="M50 66v8M38 74h24" stroke="#8f6f38" stroke-width="4"/>`);
    case 'globe': return s(`<circle cx="50" cy="46" r="24" fill="#7f8f79" stroke="#6d5228" stroke-width="3"/><ellipse cx="50" cy="46" rx="11" ry="24" fill="none" stroke="#5f6b55" stroke-width="2"/><path d="M28 40h44M26 50h48M30 58h40" stroke="#5f6b55" stroke-width="1.8"/><path d="M50 70v8M38 76h24" stroke="#6d5228" stroke-width="4"/>`);
    case 'astrolabe': return s(`<circle cx="50" cy="46" r="24" fill="none" stroke="url(#brassG)" stroke-width="3.4"/><circle cx="50" cy="46" r="16" fill="none" stroke="#c9a86a" stroke-width="2.4"/><path d="M50 22v48M26 46h48" stroke="#c9a86a" stroke-width="2.2"/><path d="m50 46 14-12" stroke="#e0c07a" stroke-width="3"/>`);
    case 'ledger': return s(`<path d="M22 34h56v34H22z" fill="#cbbb93" stroke="${stroke}" stroke-width="2.6"/><path d="M50 34v34" stroke="#7b6a45" stroke-width="2.4"/><path d="M28 42h16m-16 8h16m12-8h16m-16 8h16" stroke="#8a7c5c" stroke-width="1.8"/><path d="M22 34h56v6H22z" fill="#8d3f3c" stroke="${stroke}" stroke-width="2"/>`);
    case 'mapTable': return s(box(10, 32, 80, 38, 'url(#wood)', 3) + `<path d="M16 38h68v26H16z" fill="#d3c39c" stroke="#7b6a45" stroke-width="2"/><path d="M24 46q18-8 34 2t18 2M28 56q14 6 26-2t16 4" fill="none" stroke="#9a6b46" stroke-width="2"/>`);
    case 'telescope': return s(`<path d="M20 68 62 26l10 10-42 42z" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><circle cx="70" cy="30" r="9" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.4"/><path d="M50 70v8M34 78h32" stroke="#6b4526" stroke-width="4"/>`);
    case 'inkwell': return s(`<path d="M38 56h24l-3 20H41z" fill="#3b3a34" stroke="${stroke}" stroke-width="2.4"/><ellipse cx="50" cy="56" rx="12" ry="5" fill="#5a5850" stroke="${stroke}" stroke-width="2"/><path d="M52 52 70 26" stroke="#d9d2bc" stroke-width="2.6"/>`);
    case 'waxSeal': return s(`<circle cx="50" cy="52" r="20" fill="#8d3f3c" stroke="#5d2628" stroke-width="2.6"/><circle cx="50" cy="52" r="12" fill="none" stroke="#e0b184" stroke-width="2.4"/><path d="M50 44v16m-8-8h16" stroke="#e0b184" stroke-width="2.6"/>`);
    case 'bell': return s(`<path d="M32 66q4-30 18-30t18 30z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.8"/><ellipse cx="50" cy="67" rx="18" ry="5" fill="#8f6f38" stroke="${stroke}" stroke-width="2.2"/><circle cx="50" cy="74" r="5" fill="#c9a86a" stroke="${stroke}" stroke-width="2"/><path d="M50 30v-8" stroke="#8a6a38" stroke-width="3"/>`);
    case 'ancientSigil': return s(`<circle cx="50" cy="52" r="26" fill="none" stroke="#9a6fb8" stroke-width="3" stroke-dasharray="6 5"/><path d="m50 30 18 22-18 22-18-22z" fill="none" stroke="#b78fd4" stroke-width="2.6"/><circle cx="50" cy="52" r="7" fill="#8a5fb0" stroke="#d5bdea" stroke-width="1.8"/>`);
    case 'relicCase': return s(box(22, 26, 56, 48, '#6b6152', 3) + `<path d="M26 30h48v40H26z" fill="#9fc0c4" fill-opacity=".38" stroke="#d7e9ea" stroke-width="2"/><circle cx="50" cy="50" r="10" fill="#c9a86a" stroke="${stroke}" stroke-width="2.4"/><path d="M22 44h56" stroke="#8a8471" stroke-width="3"/>`);
    case 'candleWheel': return s(`<circle cx="50" cy="50" r="24" fill="none" stroke="url(#wood)" stroke-width="6"/><circle cx="50" cy="50" r="7" fill="#6b4526" stroke="${stroke}" stroke-width="2.4"/>${[0, 1, 2, 3, 4, 5].map((i) => `<g transform="rotate(${i * 60} 50 50)">${candle(50, 30, 16)}</g>`).join('')}`);
    case 'sacrificialKnife': return s(`<path d="M26 62 66 30l8 4-38 34z" fill="#c3c8c2" stroke="${stroke}" stroke-width="2.4"/><path d="M26 62l-6 8 10-2z" fill="#6b4526" stroke="${stroke}" stroke-width="2.2"/><path d="M34 56 68 34" stroke="#8d9287" stroke-width="1.6"/>`);
    case 'boneCharm': return s(`<path d="M50 20 62 36 50 52 38 36z" fill="url(#boneG)" stroke="${stroke}" stroke-width="2.4"/><circle cx="50" cy="36" r="5" fill="#7c5b3c"/><path d="M38 56q12 10 24 0" fill="none" stroke="#9aa093" stroke-width="2.4"/>`);
    case 'stoneEye': return s(`<path d="M18 52q32-30 64 0-32 30-64 0z" fill="url(#stoneG)" stroke="${stroke}" stroke-width="3"/><circle cx="50" cy="52" r="13" fill="#5f6b66" stroke="${stroke}" stroke-width="2.4"/><circle cx="50" cy="52" r="5" fill="#2f3a38"/>`);
    case 'crystalCluster': return s(`<path d="M50 14 64 44 50 78 36 44z" fill="#5fb0a4" stroke="#2c6f66" stroke-width="2.6"/><path d="M30 34 40 54 30 70 22 54z" fill="#7fc9bb" stroke="#2c6f66" stroke-width="2.2"/><path d="M70 30 78 52 70 68 62 50z" fill="#7fc9bb" stroke="#2c6f66" stroke-width="2.2"/><ellipse cx="50" cy="44" rx="30" ry="26" fill="url(#glowG)"/>`);
    case 'glowingMushroom': return s(`<ellipse cx="50" cy="56" rx="30" ry="20" fill="url(#glowG)"/><path d="M46 70V48q0-8 8-8t8 8v22z" fill="#cbd6c2" stroke="${stroke}" stroke-width="2"/><path d="M32 46q18-22 36 0z" fill="#5fb0a4" stroke="#2c6f66" stroke-width="2.4"/><circle cx="42" cy="40" r="3" fill="#d9f2e8"/><circle cx="58" cy="42" r="2.4" fill="#d9f2e8"/>`);
    case 'candleStand': return s(`<path d="M50 76V34" stroke="url(#brassG)" stroke-width="5"/><ellipse cx="50" cy="76" rx="16" ry="5" fill="#8f6f38" stroke="${stroke}" stroke-width="2"/><path d="M36 44h28" stroke="#c9a86a" stroke-width="4"/>${candle(36, 42, 16)}${candle(50, 40, 20)}${candle(64, 42, 16)}`);
    case 'brassScale': return s(`<path d="M50 26v42" stroke="url(#brassG)" stroke-width="4"/><path d="M22 34h56" stroke="#c9a86a" stroke-width="3"/><path d="M22 34 12 52h20zM78 34 68 52h20z" fill="none" stroke="#c9a86a" stroke-width="2.6"/><ellipse cx="22" cy="52" rx="10" ry="4" fill="#8f6f38" stroke="${stroke}" stroke-width="1.8"/><ellipse cx="78" cy="52" rx="10" ry="4" fill="#8f6f38" stroke="${stroke}" stroke-width="1.8"/><ellipse cx="50" cy="74" rx="14" ry="5" fill="#8f6f38" stroke="${stroke}" stroke-width="2"/>`);

    // ---------------- обстановка ----------------
    case 'crateStack': return s(crates(2));
    case 'crateOpen': return s(crate(26, 34, 48, 36, true));
    case 'barrelStack': return s(barrels(2));
    case 'sackPile': return s(`<path d="M28 72q-6-26 16-32 16 10 6 32z" fill="#a8926a" stroke="${stroke}" stroke-width="2.6"/><path d="M52 72q-4-22 14-26 12 8 8 26z" fill="#98825c" stroke="${stroke}" stroke-width="2.4"/><path d="M36 42h14" stroke="#6f5f40" stroke-width="3"/>`);
    case 'bucket': return s(`<path d="M32 44h36l-5 30H37z" fill="url(#wood)" stroke="${stroke}" stroke-width="2.6"/><ellipse cx="50" cy="44" rx="18" ry="6" fill="#5b4030" stroke="${stroke}" stroke-width="2.2"/><path d="M36 48q14 6 28 0" stroke="#8d8b78" stroke-width="2.4"/>`);
    case 'bucketStand': return s(`<path d="M26 76V38" stroke="#6b4526" stroke-width="5"/><path d="M74 76V38" stroke="#6b4526" stroke-width="5"/><path d="M26 44h48" stroke="#6b4526" stroke-width="4"/><path d="M34 40h14l-2 18H36z" fill="#8d5f37" stroke="${stroke}" stroke-width="2"/><path d="M52 40h14l-2 18H54z" fill="#8d5f37" stroke="${stroke}" stroke-width="2"/>`);
    case 'toolRack': return s(`<path d="M22 76V28h56v48" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M36 34v34M52 30v40M66 36v28" stroke="#b9b2a0" stroke-width="3.4"/><path d="M30 34h12l-2 8H32zM48 30h10l-1 8h-8z" fill="#9aa093" stroke="${stroke}" stroke-width="2"/>`);
    case 'anvil': return s(`<path d="M24 52h44l6 10H30z" fill="url(#ironG)" stroke="${stroke}" stroke-width="2.6"/><path d="M68 52h14v6H66z" fill="#8d9287" stroke="${stroke}" stroke-width="2"/><path d="M38 62h20v14H38z" fill="#6e7368" stroke="${stroke}" stroke-width="2"/><path d="M28 76h40v6H28z" fill="#4f5348" stroke="${stroke}" stroke-width="2"/>`);
    case 'forge': return s(box(20, 34, 60, 40, '#5d5a4f', 4) + `<path d="M30 42h40v14H30z" fill="#2a2721"/><ellipse cx="50" cy="50" rx="17" ry="8" fill="url(#emberG)"/><path d="M20 74h60" stroke="#3f3c34" stroke-width="4"/>`);
    case 'bellows': return s(`<path d="M22 46 56 36l6 14-40 10z" fill="#7b5b3c" stroke="${stroke}" stroke-width="2.6"/><path d="M62 40 78 30l8 18-18 6z" fill="#8d6b46" stroke="${stroke}" stroke-width="2.4"/><path d="M56 36v16" stroke="#4a3320" stroke-width="3"/>`);
    case 'cauldron': return s(`<path d="M26 44h48q-4 28-24 28T26 44z" fill="url(#ironG)" stroke="${stroke}" stroke-width="3"/><ellipse cx="50" cy="44" rx="24" ry="7" fill="#3f433a" stroke="${stroke}" stroke-width="2.4"/><path d="M32 72q18 8 36 0" fill="none" stroke="#8a8471" stroke-width="2.6"/><path d="M50 30v14" stroke="#8a8471" stroke-width="3"/>`);
    case 'workbench': return s(plank(16, 44, 68, 16) + `<path d="M24 60v18M76 60v18" stroke="#6b4526" stroke-width="5"/><path d="M30 40h14v8H30z" fill="#9aa093" stroke="${stroke}" stroke-width="2"/><circle cx="62" cy="40" r="7" fill="url(#brassG)" stroke="${stroke}" stroke-width="2"/>`);
    case 'vise': return s(box(30, 44, 40, 22, 'url(#ironG)', 3) + `<path d="M30 50h-10v14h10" fill="#6e7368" stroke="${stroke}" stroke-width="2.4"/><path d="M70 50h10v14H70" fill="#6e7368" stroke="${stroke}" stroke-width="2.4"/><path d="M50 40v8" stroke="#9aa093" stroke-width="4"/>`);
    case 'mineCart': return s(box(18, 44, 64, 26, '#6d6558', 4) + `<path d="M22 70h56" stroke="#5a5248" stroke-width="3"/><circle cx="34" cy="76" r="7" fill="#4a4740" stroke="#8a8471" stroke-width="2.4"/><circle cx="66" cy="76" r="7" fill="#4a4740" stroke="#8a8471" stroke-width="2.4"/><path d="M26 48h48v18H26z" fill="#3d3a33"/>`);
    case 'ladder': return s(`<path d="M28 78 36 22M62 78 54 22" stroke="#8d5f37" stroke-width="4"/><path d="M32 34h26M31 48h26M30 62h26" stroke="#a97c48" stroke-width="3.4"/>`);
    case 'scaffold': return s(`<path d="M22 78V26M78 78V26M22 44h56M22 62h56" stroke="#8d5f37" stroke-width="5"/><path d="M22 26 78 44M78 26 22 44" stroke="#a97c48" stroke-width="3"/><path d="M18 78h64" stroke="#6b4526" stroke-width="4"/>`);
    case 'rope': return s(`<path d="M42 12q-8 22 8 30t8 26" fill="none" stroke="#c0a878" stroke-width="4"/><circle cx="50" cy="70" r="5" fill="none" stroke="#8d7448" stroke-width="3"/>`);
    case 'ropeCoil': return s(`<ellipse cx="50" cy="54" rx="28" ry="18" fill="none" stroke="#c0a878" stroke-width="5"/><ellipse cx="50" cy="54" rx="18" ry="11" fill="none" stroke="#a08a5c" stroke-width="4"/><ellipse cx="50" cy="54" rx="8" ry="5" fill="none" stroke="#c0a878" stroke-width="3"/>`);
    case 'pulley': return s(`<circle cx="50" cy="36" r="16" fill="none" stroke="#8a8471" stroke-width="4"/><circle cx="50" cy="36" r="4" fill="#6b4526"/><path d="M50 52v22" stroke="#c0a878" stroke-width="3"/><path d="M36 76h28" stroke="#6b4526" stroke-width="5"/>`);
    case 'winch': return s(`<path d="M24 76h52" stroke="#6b4526" stroke-width="6"/><rect x="38" y="40" width="24" height="16" rx="3" fill="url(#wood)" stroke="${stroke}" stroke-width="2.4"/><path d="M62 48h16" stroke="#8a8471" stroke-width="3"/><circle cx="50" cy="48" r="9" fill="none" stroke="#9aa093" stroke-width="3"/>`);
    case 'counterweight': return s(box(34, 40, 32, 36, '#6e6a5c', 3) + `<path d="M50 40V22" stroke="#8a8471" stroke-width="3"/><path d="M38 52h24M38 62h24" stroke="#54513f" stroke-width="2.4"/>`);
    case 'shelf': return s(box(18, 30, 64, 42, 'url(#wood)', 3) + `<path d="M22 46h56M22 60h56" stroke="#4a3020" stroke-width="3"/><rect x="26" y="34" width="10" height="11" fill="#8b7350" stroke="${stroke}" stroke-width="1.8"/><rect x="40" y="36" width="9" height="9" fill="#6f5f7a" stroke="${stroke}" stroke-width="1.8"/><circle cx="66" cy="54" r="6" fill="#9aa093" stroke="${stroke}" stroke-width="1.8"/>`);
    case 'scrollRack': return s(box(22, 28, 56, 44, 'url(#wood)', 3) + [0, 1, 2, 3, 4].map((i) => `<rect x="${28 + i * 10}" y="${36 + (i % 2) * 8}" width="7" height="20" rx="2" fill="#d3c39c" stroke="${stroke}" stroke-width="1.8"/>`).join('') + `<path d="M24 46h52" stroke="#4a3020" stroke-width="3"/>`);
    case 'hayPile': return s(`<path d="M18 76q10-34 32-34t32 34z" fill="#c2a862" stroke="${stroke}" stroke-width="2.6"/><path d="M32 70l10-22m6 22 6-20m8 20 6-16" stroke="#9c8548" stroke-width="2"/>`);
    case 'cage': return s(iron(24, 22, 52, 56) + [0, 1, 2, 3].map((i) => `<path d="M${32 + i * 12} 26v48" stroke="#a3a795" stroke-width="3"/>`).join('') + `<path d="M24 46h52" stroke="#a3a795" stroke-width="3"/>`);
    case 'cageDoor': return s(iron(32, 22, 44, 54) + `<path d="M64 24 34 48" stroke="#9aa093" stroke-width="3.4"/><circle cx="56" cy="52" r="4" fill="#c9a86a" stroke="${stroke}" stroke-width="1.8"/>`);
    case 'pillory': return s(`<path d="M30 76V34h40v42" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M40 34h20v16H40z" fill="#3d2515" stroke="${stroke}" stroke-width="2.4"/><circle cx="43" cy="42" r="4" fill="none" stroke="#8a8471" stroke-width="2.4"/><circle cx="57" cy="42" r="4" fill="none" stroke="#8a8471" stroke-width="2.4"/>`);
    case 'stocks': return s(`<path d="M22 62h56v16H22z" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M30 62V44h18v18M54 62V44h18v18" fill="none" stroke="#6b4526" stroke-width="4"/><circle cx="39" cy="50" r="4" fill="none" stroke="#8a8471" stroke-width="2.2"/><circle cx="63" cy="50" r="4" fill="none" stroke="#8a8471" stroke-width="2.2"/>`);
    case 'manacles': return s(`<circle cx="38" cy="54" r="14" fill="none" stroke="#8f9284" stroke-width="4"/><circle cx="62" cy="58" r="12" fill="none" stroke="#7c8073" stroke-width="4"/><path d="M50 50h6" stroke="#6f7266" stroke-width="3"/>`);
    case 'tortureRack': return s(`<path d="M22 78 30 26M78 78 70 26" stroke="#6b4526" stroke-width="5"/><path d="M30 30h40" stroke="#8d5f37" stroke-width="4"/><path d="M36 36v34M62 36v34" stroke="#b9b2a0" stroke-width="3"/><path d="M30 56h40" stroke="#6b4526" stroke-width="4"/>`);
    case 'gibbet': return s(`<path d="M50 10v16" stroke="#7d8274" stroke-width="3"/><rect x="34" y="26" width="32" height="34" rx="4" fill="none" stroke="#8f9284" stroke-width="3.4"/><path d="M34 40h32M42 26v34M58 26v34" stroke="#7c8073" stroke-width="2.4"/>`);
    case 'brazierStand': return s(`<path d="M50 74 32 40M50 74 68 40M50 74V34" stroke="#6f7266" stroke-width="3.4"/><path d="M30 38h40l-6 14H36z" fill="url(#ironG)" stroke="${stroke}" stroke-width="2.4"/><ellipse cx="50" cy="40" rx="16" ry="5" fill="url(#emberG)"/>`);
    case 'candleHolder': return s(`<path d="M50 76V40" stroke="url(#brassG)" stroke-width="4"/><path d="M36 40h28" stroke="#c9a86a" stroke-width="3"/>${candle(36, 38, 14)}${candle(50, 36, 18)}${candle(64, 38, 14)}<circle cx="50" cy="80" r="5" fill="#8f6f38" stroke="${stroke}" stroke-width="2"/>`);
    case 'sawhorse': return s(`<path d="M22 68 40 40l4 22zM58 68 60 40l18 28z" fill="#6b4526" stroke="${stroke}" stroke-width="2.6"/><path d="M20 68h60" stroke="#8d5f37" stroke-width="5"/><path d="M34 68 44 48M66 68 56 48" stroke="#5b3d24" stroke-width="3"/>`);
    case 'barrelTap': return s(`<ellipse cx="46" cy="34" rx="22" ry="9" fill="url(#wood)" stroke="${stroke}" stroke-width="2.6"/><path d="M24 34v32q22 10 44 0V34" fill="#6d4826" stroke="${stroke}" stroke-width="2.6"/><path d="M60 56h12v10" stroke="#9aa093" stroke-width="3.4"/><circle cx="72" cy="66" r="4" fill="#c9a86a" stroke="${stroke}" stroke-width="1.6"/>`);
    case 'coalHeap': return s(`<path d="M16 76q12-32 34-32t34 32z" fill="#2e2c2a" stroke="${stroke}" stroke-width="2.6"/><path d="M32 70l8-10m10 12 8-12m8 10 6-8" stroke="#4b4744" stroke-width="2.4"/>`);
    case 'toolbox': return s(box(22, 44, 56, 26, 'url(#wood)', 3) + `<path d="M22 50h56" stroke="#4a3020" stroke-width="2.6"/><path d="M40 44v-8h20v8" fill="none" stroke="#8a8471" stroke-width="3"/><path d="M44 38h12" stroke="#c9a86a" stroke-width="2.4"/>`);
    case 'net': return s(`<path d="M22 26q28 44 56 0" fill="none" stroke="#b8b09a" stroke-width="3"/><path d="M28 30q22 34 44 0" fill="none" stroke="#9c957f" stroke-width="2"/><path d="M50 26v40" stroke="#a49c86" stroke-width="2"/>`);
    case 'fishNet': return s(`<path d="M20 70q30-30 60 0z" fill="#6d7a6a" fill-opacity=".35" stroke="#93a08c" stroke-width="2.6"/><path d="M26 66h48M32 58h36M40 50h20M50 26v44" stroke="#8d9a86" stroke-width="1.6"/><circle cx="30" cy="70" r="4" fill="#6f7266" stroke="${stroke}" stroke-width="1.8"/>`);
    case 'beamSupport': return s(`<path d="M18 30h64v12H18z" fill="url(#wood)" stroke="${stroke}" stroke-width="3"/><path d="M26 42 20 74M74 42 80 74" stroke="#6b4526" stroke-width="4"/><path d="M28 56h44" stroke="#8d5f37" stroke-width="3.4"/>`);
    case 'dryingRack': return s(`<path d="M22 76V24M78 76V24" stroke="#6b4526" stroke-width="5"/><path d="M22 36h56M22 52h56" stroke="#8d5f37" stroke-width="3.4"/><path d="M32 36v14m14-10v16m18-14v14" stroke="#7d8a62" stroke-width="3"/>`);
    case 'signalHorn': return s(`<path d="M20 56q22-14 44 0l-6 12H26z" fill="url(#brassG)" stroke="${stroke}" stroke-width="2.6"/><path d="M64 52q12 4 0 8" fill="none" stroke="#c9a86a" stroke-width="3"/><path d="M26 68l-6 10M54 68l6 10" stroke="#8a8471" stroke-width="3"/>`);
    case 'oilLamp': return s(`<path d="M38 56h24l-3 20H41z" fill="#6b6152" stroke="${stroke}" stroke-width="2.4"/><ellipse cx="50" cy="56" rx="12" ry="4" fill="#8a8471" stroke="${stroke}" stroke-width="2"/><ellipse cx="50" cy="46" rx="7" ry="8" fill="#f2c268" stroke="#a8721f" stroke-width="1.8"/>`);
    case 'oldCradle': return s(`<path d="M28 68q22-26 44 0z" fill="url(#wood)" stroke="${stroke}" stroke-width="2.8"/><path d="M28 68h44" stroke="#4a3020" stroke-width="3"/><path d="M50 68V42" stroke="#8d5f37" stroke-width="3"/><path d="M40 44h20" stroke="#a97c48" stroke-width="2.6"/>`);
    default: {
      const spec = CRYPT[kind];
      return s(box(28, 34, 44, 34, 'url(#stoneG)', 3) + `<path d="M34 40h32M34 50h32M34 60h32" stroke="#6e6a5b" stroke-width="2.2"/><text x="50" y="80" font-size="9" text-anchor="middle" fill="#8a8471">${spec.label}</text>`);
    }
  }
}
