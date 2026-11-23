const stone = '#787366', line = '#373129';
const rect = (x: number, y: number, w: number, h: number, fill: string, r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${line}" stroke-width="2"/>`;
const circle = (x: number, y: number, r: number, fill: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${line}" stroke-width="2"/>`;
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><radialGradient id="deep"><stop offset="0.42" stop-color="#111219"/><stop offset="1" stop-color="#5b554c"/></radialGradient><linearGradient id="edge"><stop stop-color="#a39a84"/><stop offset="1" stop-color="#605d52"/></linearGradient><radialGradient id="fire"><stop stop-color="#fff5c0"/><stop offset=".44" stop-color="#e3a254"/><stop offset="1" stop-color="#763a28"/></radialGradient></defs>${body}</svg>`)}`;
const plate = rect(9, 9, 82, 82, '#5f5d53', 5) + `<path d="M13 84V13h73" fill="none" stroke="#a7a18b" stroke-width="2"/>`;
const bolt = [[17, 17], [83, 17], [17, 83], [83, 83]].map(([x, y]) => circle(x, y, 3.7, '#baae91')).join('');
const bridge = Array.from({ length: 9 }, (_, i) => rect(10 + i * 9, 26 + (i % 3), 9, 49 - (i % 2), ['#997754', '#85684f', '#71533a'][i % 3], 1)).join('');
const steps = Array.from({ length: 7 }, (_, i) => rect(22 - i * 2, 9 + i * 12, 56 + i * 4, 11, `hsl(37 11% ${28 + i * 5}%)`, 1)).join('');
// Лестничный пролёт 2×2: ступени темнеют к спуску и светлеют к подъёму.
const flight = (down: boolean) => Array.from({ length: 8 }, (_, i) => rect(12, 10 + i * 10, 76, 10, `hsl(36 10% ${down ? 62 - i * 6 : 20 + i * 6}%)`, 1)).join('');
const cross = `<path d="M24 24 76 76M76 24 24 76" stroke="#c18167" stroke-width="5" stroke-linecap="round"/>`;
const diamond = `<path d="m50 20 28 30-28 30-28-30z" fill="none" stroke="#c48a65" stroke-width="3"/>`;

export const cryptVectors: Record<string, string> = {
  'crypt-chasm': svg(`<path d="m9 26 15-16 14 6 17-9 11 8 17-1 9 16-6 14 7 16-12 8-8 17-16-4-16 10-12-9-17 1-3-18-8-11 8-14z" fill="url(#edge)" stroke="${line}" stroke-width="3"/><path d="m18 31 13-12 13 4 14-9 21 11 6 11-8 10 7 18-15 7-4 8-18-1-14 5-14-10-4-11-7-12z" fill="url(#deep)" stroke="#4d4844" stroke-width="4"/>`),
  'crypt-grate': svg(plate + rect(19, 19, 62, 62, '#282a29', 3) + [27, 42, 57, 72].map((i) => `<path d="M${i} 19v62M19 ${i}h62" stroke="#8b8370" stroke-width="3"/>`).join('') + bolt),
  'crypt-bridge': svg(bridge + `<path d="M7 27h86M7 72h86" stroke="#ba9a64" stroke-width="4"/><path d="M12 22v56M89 22v56" stroke="#5f4c39" stroke-width="3"/>`),
  'crypt-spikeGlyph': svg(plate + bolt + `<path d="m23 66 10-34 10 34zm20 0 9-40 10 40zm20 0 10-33 8 33z" fill="#ad7e67" stroke="#442f28" stroke-width="2"/>`),
  'crypt-pressureTile': svg(plate + rect(18, 18, 64, 64, '#787464', 7) + bolt + diamond + circle(50, 50, 7.5, '#b68467')),
  'crypt-runeTrap': svg(plate + `<circle cx="50" cy="50" r="35" stroke="#c78673" stroke-width="3" fill="#614e54"/><path d="m50 23 23 38H27zm0 13 15 21H36z" stroke="#e9a492" stroke-width="2.8" fill="none"/>` + circle(50, 67, 3.4, '#ebac91')),
  'crypt-fallSeal': svg(plate + rect(16, 16, 68, 68, '#282726', 0) + `<path d="M20 22h60v56H20z" fill="#4d4640" stroke="#9c8370" stroke-width="2" stroke-dasharray="6 4"/>` + cross),
  'crypt-steps': svg(rect(4, 4, 92, 92, '#514b42', 4) + steps + `<path d="M50 24v30m-8-9 8 9 8-9" fill="none" stroke="#d4c2a0" stroke-width="3"/>`),
  'crypt-stairsDown': svg(rect(4, 4, 92, 92, '#3d3830', 5) + flight(true) + `<path d="M8 8v84M92 8v84" stroke="#2a2621" stroke-width="5"/><path d="M50 26v40m-11-12 11 12 11-12" fill="none" stroke="#ead9b4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  'crypt-stairsUp': svg(rect(4, 4, 92, 92, '#4a443a', 5) + flight(false) + `<path d="M8 8v84M92 8v84" stroke="#2a2621" stroke-width="5"/><path d="M50 74V34m-11 12 11-12 11 12" fill="none" stroke="#ead9b4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  'crypt-pillar': svg(rect(9, 9, 82, 82, '#645d50', 7) + rect(16, 16, 68, 68, '#8f8775', 5) + circle(50, 50, 25, stone) + `<path d="M29 56a23 23 0 0 1 14-27 M52 72l-9-12 12-14-5-12" fill="none" stroke="#bab19c" stroke-width="3"/>`),
  'crypt-statue': svg(rect(17, 11, 66, 78, '#817c6f', 8) + rect(23, 17, 54, 64, '#99917c', 5) + `<path d="M33 67l4-28 8-9h10l9 9 4 28-15 7z" fill="#6b6b61" stroke="#544e46" stroke-width="2.5"/>` + circle(50, 29, 9, '#a5a093') + `<path d="m55 42 8 20M44 40l-6 18m9 6 6-14 4 16" stroke="#b5ad96" fill="none" stroke-width="3"/>`),
  'crypt-brazier': svg(circle(50, 50, 38, '#5a4d3c') + circle(50, 50, 31, '#a2875e') + circle(50, 50, 23, 'url(#fire)') + `<path d="M19 50h62M50 19v62M28 28l44 44m0-44L28 72" stroke="#624833" stroke-width="3"/><path d="M45 57l7-24 8 19-7 8z" fill="#f4d798"/>`),
  'crypt-candles': svg(rect(19, 31, 62, 38, '#8d775c', 9) + [29, 50, 69].map((x, i) => circle(x, 47 + i % 2 * 8, 10.5, '#d3b88b') + circle(x, 45 + i % 2 * 8, 4.8, '#fce5a5')).join('')),
  'crypt-incense': svg(circle(50, 52, 28, '#94754f') + circle(50, 52, 21, '#6e5841') + `<path d="M36 66 64 37M38 39l24 28" stroke="#c3a574" stroke-width="3"/><path d="M51 46q-16-13 0-23t4-13" fill="none" stroke="#b7a69b" stroke-opacity=".7" stroke-width="4"/>`),
  'crypt-chains': svg(Array.from({ length: 12 }, (_, i) => `<ellipse cx="${18 + i * 5.8}" cy="${50 + Math.sin(i * .8) * 15}" rx="8.9" ry="6" fill="none" stroke="${i % 2 ? '#7f7967' : '#a19880'}" stroke-width="3.6"/>`).join('')),
  'crypt-web': svg(`<path d="M11 13 88 16M11 13l4 77m-4-77 57 54m-57-54 14 59m-14-59 62 23m-3-19-5 14-18 15-17 12-14 8m31-50-4 10-12 9-7 5-9 6" fill="none" stroke="#d2c9b1" stroke-opacity=".68" stroke-width="2.6" stroke-linecap="round"/>`),
  'crypt-bench': svg(rect(7, 26, 86, 47, '#544c40', 3) + rect(8, 21, 84, 43, '#908773', 3) + `<path d="M13 25h72m-71 10 21 1-3 15 27 6 25-6M22 22v40m57-40v40" fill="none" stroke="#665d50" stroke-width="2.7"/>`),
};