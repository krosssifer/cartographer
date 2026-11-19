const outline = '#39271d';
const rounded = (x: number, y: number, w: number, h: number, color: string, r = 5, stroke = outline) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}" stroke="${stroke}" stroke-width="3"/>`;
const disc = (x: number, y: number, r: number, color: string, stroke = outline) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${stroke}" stroke-width="2.6"/>`;
const seams = (w: number, h: number, accent = '#f6cd9652') =>
  `<path d="M9 ${h * .21} H${w - 9} M9 ${h * .51} H${w - 9} M9 ${h * .78} H${w - 9}" fill="none" stroke="#4c3022" stroke-width="1.7"/><path d="m13 ${h * .25} ${w * .31} -1 m${w * .05} ${h * .32} ${w * .29} .5 M20 ${h * .84}h${w * .5}" fill="none" stroke="${accent}" stroke-width="1.2" stroke-linecap="round"/>`;
const oak = (w: number, h: number) => rounded(3, 4, w - 6, h - 8, 'url(#oak)', 3) + seams(w, h);
const plate = (x: number, y: number, r = 9) => disc(x, y, r, '#b7a081') + disc(x + .4, y + .4, r * .65, '#8b775e');

const svg = (w: number, h: number, body: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="oak" x2=".4" y2="1"><stop stop-color="#be8f55"/><stop offset=".42" stop-color="#8b5d38"/><stop offset="1" stop-color="#563721"/></linearGradient><linearGradient id="iron" x2=".6" y2="1"><stop stop-color="#9e8e77"/><stop offset="1" stop-color="#494137"/></linearGradient><linearGradient id="clay" x2=".5" y2="1"><stop stop-color="#c2885e"/><stop offset="1" stop-color="#89462d"/></linearGradient></defs>${body}</svg>`,
)}`;

const books = Array.from({ length: 9 }, (_, i) => {
  const tone = ['#6d3833', '#ad8b53', '#545c43', '#69554a', '#9b5940'][i % 5], x = 13 + 9.6 * i;
  return `<rect x="${x}" y="${10 + i % 3 * 2}" width="6.8" height="23" rx="1" fill="${tone}" stroke="#35281d" stroke-width="1.2"/><path d="M${x + 1} 27h4" stroke="#dfc48e" stroke-width="1"/>`;
}).join('');

export const furnitureVectors: Record<string, string> = {
  'furniture-longTable': svg(140, 66, oak(140, 66) + plate(38, 28) + plate(100, 39) + disc(83, 21, 5, '#c4a47a') + disc(54, 43, 6, '#b2a384') + `<path d="M13 11h114M13 55h114" stroke="#edb77e66" stroke-width="1.7"/>`),
  'furniture-bench': svg(122, 37, oak(122, 37) + `<path d="M17 7v23m88-23v23" stroke="#4c3021" stroke-width="4"/><path d="M9 10h104" stroke="#d6ad7b" stroke-width="1.2"/>`),
  'furniture-stool': svg(60, 60, disc(30, 30, 27, 'url(#oak)') + `<path d="M9 27h42M13 38h34" stroke="#5d3b25" stroke-width="2"/><circle cx="30" cy="30" r="23" fill="none" stroke="#d6a675" stroke-opacity=".52" stroke-width="1.7"/>`),
  'furniture-desk': svg(98, 58, oak(98, 58) + `<path d="m34 13 28-2 3 27-30 1z" fill="#dec9a4" stroke="#6b543c" stroke-width="1.4"/><path d="m40 20 17-1m-16 5 16-1m-14 6 11-1" stroke="#8e7652" stroke-width="1.3"/><path d="m71 36 9-19-3 13z" fill="#d9d3bc"/>` + disc(73, 37, 4, '#322b24')),
  'furniture-bookcase': svg(108, 45, rounded(2, 3, 104, 39, 'url(#oak)', 3) + `<path d="M8 7h90v29H8z" fill="#4c3127"/>${books}<path d="M8 35h92M6 7h94" stroke="#b48d56" stroke-width="3"/>`),
  'furniture-stove': svg(108, 76, rounded(3, 3, 102, 70, 'url(#iron)', 7) + `<path d="M14 10h80v44H14z" fill="#3d362d" stroke="#ada28e" stroke-width="2"/><path d="M13 64h82" stroke="#312b25" stroke-width="3"/>` + disc(39, 31, 15, '#62584b') + disc(74, 32, 11, '#756a56') + disc(39, 30, 8, '#34312a') + `<path d="M77 65h12" stroke="#d1884b" stroke-width="3"/>`),
  'furniture-worktop': svg(110, 52, oak(110, 52) + rounded(26, 13, 31, 25, '#d0a174', 3, '#805e43') + `<path d="m34 32 18-11 2 2-17 11z" fill="#b6b0a2"/>` + disc(75, 19, 6, '#776943') + disc(86, 29, 7, '#a85b3b') + disc(75, 31, 5, '#ad9b57')),
  'furniture-cupboard': svg(110, 40, oak(110, 40) + rounded(9, 8, 92, 22, '#503426', 2) + [18, 28, 46, 58, 76, 89].map((x, i) => disc(x, 21 - i % 2 * 2, 5 + i % 3, ['#d4c2a2', '#9b6045', '#77826a'][i % 3])).join('') + `<path d="M8 32h93" stroke="#b18a5d" stroke-width="3"/>`),
  'furniture-basin': svg(64, 63, disc(32, 31, 29, '#67543c') + disc(32, 30, 22, '#c3b495') + disc(32, 30, 17, '#638a7d') + `<path d="M19 32q7 9 15 4m4-13 6 5" fill="none" stroke="#d4dac1" stroke-width="1.5"/>`),
  'furniture-jars': svg(88, 60, disc(24, 24, 19, 'url(#clay)') + disc(56, 32, 23, '#9a6449') + disc(65, 49, 8, '#c09b69') + disc(23, 23, 10, '#4f3226') + disc(56, 31, 12, '#563a29') + `<path d="M11 24c1-11 8-14 13-15m16 20c4-11 11-14 18-14" stroke="#e3a078" stroke-width="2" fill="none"/>`),
  'furniture-basket': svg(75, 58, `<ellipse cx="37" cy="29" rx="34" ry="25" fill="#94734b" stroke="#503623" stroke-width="3"/><ellipse cx="37" cy="29" rx="28" ry="19" fill="#675138" stroke="#c19c62" stroke-width="4"/><path d="M18 33q19-20 37 0M20 36q17-16 34 0M26 37q11-12 23 0" stroke="#b38f58" fill="none" stroke-width="2"/>`),
  'furniture-lantern': svg(52, 54, disc(26, 27, 24, '#735337') + disc(26, 27, 18, '#d69d53') + disc(26, 27, 11, '#eac37b') + `<path d="M12 12l27 28m1-27L12 41" stroke="#5b4632" stroke-width="3"/><circle cx="26" cy="27" r="5" fill="#f3dc97"/>`),
  'furniture-screen': svg(112, 41, `<path d="M3 29l26-22 27 22L83 7l26 22v8L83 17 56 39 29 17 3 37Z" stroke="#513826" stroke-width="3" fill="#a88757"/><path d="M6 30l23-19 27 22 27-22 24 19" stroke="#dbbe87" fill="none" stroke-width="2"/>`),
  'furniture-linen': svg(121, 71, rounded(3, 4, 115, 63, '#686845', 2, '#ad9967') + `<path d="M11 12h99v47H11z" stroke="#b6a97a" stroke-width="2" fill="none"/><path d="m20 35 19-14 21 14 21-14 19 14-19 14-21-14-21 14z" stroke="#ccb27b" fill="#8c8459" stroke-width="1.9"/><path d="M2 16h6m-6 10h6m-6 10h6m-6 10h6m-6 10h6M114 16h6m-6 10h6m-6 10h6m-6 10h6m-6 10h6" stroke="#c6b17a" stroke-width="2"/>`),
};