import { hash2 } from './random';
import type { Biome, MapData } from './types';

export type DoorStyle = 'oak' | 'rustic' | 'mossy' | 'cedar' | 'frost' | 'iron' | 'stone' | 'grille' | 'carved';
const doorSets: Record<Biome, readonly DoorStyle[]> = {
  forest: ['rustic', 'oak'], plains: ['oak', 'rustic'], swamp: ['mossy', 'rustic'], desert: ['cedar', 'carved'], snow: ['frost', 'oak'],
  cave: ['stone', 'grille'], dungeon: ['iron', 'stone', 'grille'], village: ['rustic', 'oak'], town: ['carved', 'iron', 'oak'],
};
export const doorStyle = (biome: Biome, x: number, y: number, seed: number): DoorStyle => {
  const list = doorSets[biome];
  return list[Math.floor(hash2(x, y, seed + 62817) * list.length)];
};

export function doorAxis(map: MapData, x: number, y: number): 'horizontal' | 'vertical' {
  const t = (dx: number, dy: number) => map.cells[y + dy]?.[x + dx]?.terrain;
  const wall = (tile: unknown) => ['wall', 'caveWall', 'buildingWall', 'void'].includes(String(tile));
  const floor = (tile: unknown) => ['floor', 'caveFloor', 'grass', 'dirt', 'road', 'plaza', 'buildingFloor', 'sand', 'snow'].includes(String(tile));
  const across = Number(wall(t(-1, 0))) + Number(wall(t(1, 0)));
  const along = Number(wall(t(0, -1))) + Number(wall(t(0, 1)));
  return across * 3 + 2 * (Number(floor(t(0, -1))) + Number(floor(t(0, 1)))) >= along * 3 + 2 * (Number(floor(t(-1, 0))) + Number(floor(t(1, 0)))) ? 'horizontal' : 'vertical';
}

// Coordinates are in map cells; the opening always spans the local horizontal axis.
export function drawDoor(ctx: CanvasRenderingContext2D, style: DoorStyle, width = .86, opened = false) {
  ctx.save();
  ctx.scale(width / .86, 1);
  const rocky = style === 'stone', barred = style === 'grille', ornate = style === 'carved', weather = style === 'mossy';
  const metal = style === 'iron' || barred, cold = style === 'frost';
  const stone = rocky || metal || ornate;
  const frame = cold ? '#acae9d' : weather ? '#6f7458' : stone ? '#a69a80' : '#987449';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#1d211fa0'; ctx.fillRect(-.46, -.20, .96, .46);
  ctx.fillStyle = frame; ctx.fillRect(-.45, -.14, .9, .28);
  ctx.strokeStyle = '#3d352b'; ctx.lineWidth = .035; ctx.strokeRect(-.45, -.14, .9, .28);
  ctx.strokeStyle = '#e1cfac94'; ctx.lineWidth = .025; ctx.beginPath(); ctx.moveTo(-.43, -.116); ctx.lineTo(.43, -.116); ctx.stroke();
  ctx.fillStyle = '#28251f'; ctx.fillRect(-.35, -.10, .7, .2);
  for (const x of [-.455, .36]) {
    ctx.fillStyle = frame; ctx.fillRect(x, -.22, .096, .44);
    ctx.strokeStyle = '#3a3229'; ctx.lineWidth = .023; ctx.strokeRect(x, -.22, .096, .44);
    ctx.fillStyle = '#ead7b05c'; ctx.fillRect(x + .013, -.20, .024, .39);
  }
  ctx.save(); ctx.translate(-.346, 0);
  if (opened && !rocky && !barred) ctx.rotate(-.62);
  const tones = rocky ? ['#a5a18e', '#787b6e', '#53594f'] : metal ? ['#798076', '#555d53', '#3f473f'] : cold ? ['#a8987d', '#81745e', '#625842']
    : weather ? ['#8e8461', '#666747', '#4a4c35'] : style === 'cedar' ? ['#cd9b61', '#ac784b', '#805635'] : ['#b99460', '#91663e', '#5f4029'];
  const material = ctx.createLinearGradient(0, -.14, .03, .14);
  material.addColorStop(0, tones[0]); material.addColorStop(.25, tones[1]); material.addColorStop(1, tones[2]);
  ctx.fillStyle = material; ctx.fillRect(0, -.125, .69, .25);
  ctx.strokeStyle = '#332b23'; ctx.lineWidth = .035; ctx.strokeRect(0, -.125, .69, .25);
  if (barred) {
    ctx.fillStyle = '#18201d'; ctx.fillRect(.045, -.10, .60, .20);
    ctx.strokeStyle = '#a0a28c'; ctx.lineWidth = .031; ctx.beginPath();
    for (let x = .08; x < .65; x += .095) { ctx.moveTo(x, -.11); ctx.lineTo(x, .11); }
    ctx.moveTo(.03, 0); ctx.lineTo(.66, 0); ctx.stroke();
  } else if (rocky) {
    ctx.strokeStyle = '#c3c1a18a'; ctx.lineWidth = .022;
    ctx.beginPath(); ctx.moveTo(.348, -.10); ctx.lineTo(.348, .105); ctx.stroke();
    ctx.strokeStyle = '#5e77714f'; ctx.lineWidth = .023; ctx.beginPath();
    ctx.moveTo(.10, .06); ctx.lineTo(.15, -.06); ctx.lineTo(.20, .05); ctx.moveTo(.48, .07); ctx.lineTo(.52, -.07); ctx.lineTo(.58, .06); ctx.stroke();
    ctx.strokeStyle = '#4a5046'; ctx.beginPath(); ctx.moveTo(.29, -.12); ctx.lineTo(.26, -.025); ctx.lineTo(.31, .06); ctx.stroke();
  } else {
    ctx.strokeStyle = '#392b217d'; ctx.lineWidth = .016; ctx.beginPath();
    for (let x = .1; x < .69; x += .1) { ctx.moveTo(x, -.1); ctx.lineTo(x, .105); } ctx.stroke();
    const straps = ornate || style === 'cedar' ? '#c9a46a' : '#4d5144';
    ctx.fillStyle = straps;
    for (const x of [.12, .50]) { ctx.fillRect(x, -.133, .045, .265); ctx.fillStyle = '#ddd2aa'; ctx.beginPath(); ctx.arc(x + .024, -.074, .012, 0, Math.PI * 2); ctx.arc(x + .024, .07, .012, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = straps; }
    if (style === 'rustic') { ctx.strokeStyle = '#c49d69'; ctx.lineWidth = .025; ctx.beginPath(); ctx.moveTo(.04, -.08); ctx.lineTo(.64, .08); ctx.stroke(); }
    if (ornate) { ctx.strokeStyle = '#e3bb76'; ctx.lineWidth = .014; ctx.strokeRect(.22, -.081, .21, .158); }
  }
  ctx.strokeStyle = rocky ? '#8e9e85' : '#dfbd7f'; ctx.lineWidth = .018; ctx.beginPath(); ctx.arc(.596, .006, .032, 0, Math.PI * 2); ctx.stroke();
  if (cold) { ctx.strokeStyle = '#d9e8e5a8'; ctx.lineWidth = .025; ctx.beginPath(); ctx.moveTo(.01, -.128); ctx.lineTo(.21, -.128); ctx.moveTo(.47, -.128); ctx.lineTo(.67, -.128); ctx.stroke(); }
  if (weather) { ctx.fillStyle = '#6c8155a0'; ctx.fillRect(.02, .07, .10, .06); ctx.fillRect(.46, -.14, .06, .08); }
  ctx.restore();
  if (opened && !rocky && !barred) { ctx.strokeStyle = '#b9a18058'; ctx.lineWidth = .014; ctx.setLineDash([.035, .045]); ctx.beginPath(); ctx.arc(-.346, 0, .655, -.62, 0); ctx.stroke(); }
  ctx.restore();
}