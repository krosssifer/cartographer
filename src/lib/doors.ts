import { hash2 } from './random';
import type { Biome, DoorKind, MapData } from './types';

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
/** Вид двери в клетке: без записи в map.doors — обычная дверь. */
export function doorKindAt(map: MapData, x: number, y: number): DoorKind {
  return map.doors?.find((door) => door.x === x && door.y === y)?.kind ?? 'normal';
}

export const DOOR_KIND_LABELS: Record<DoorKind, string> = {
  normal: 'Обычная', double: 'Двустворчатая', arch: 'Арка', secret: 'Потайная', broken: 'Выбитая',
  blocked: 'Завал', portcullis: 'Решётка', gate: 'Ворота',
};
export const DOOR_KINDS = Object.keys(DOOR_KIND_LABELS) as DoorKind[];

/** Изменяет вид двери: 'normal' не хранится, метки вне клеток-дверей удаляются. */
export function setDoorKind(map: MapData, x: number, y: number, kind: DoorKind): MapData {
  const rest = (map.doors ?? []).filter((door) => !(door.x === x && door.y === y));
  const doors = kind === 'normal' || map.cells[y]?.[x]?.terrain !== 'door' ? rest : [...rest, { x, y, kind }];
  if (!doors.length && !map.doors) return map;
  return { ...map, doors: doors.length ? doors : undefined };
}

/** Метки видов дверей, чья клетка перестала быть дверью, удаляются. */
export function pruneDoors(map: MapData): MapData {
  if (!map.doors) return map;
  const doors = map.doors.filter((door) => map.cells[door.y]?.[door.x]?.terrain === 'door');
  if (doors.length === map.doors.length) return map;
  return { ...map, doors: doors.length ? doors : undefined };
}

function frame(ctx: CanvasRenderingContext2D, colour: string) {
  ctx.fillStyle = '#1d211fa0'; ctx.fillRect(-.48, -.20, .98, .46);
  for (const x of [-.48, .384]) {
    ctx.fillStyle = colour; ctx.fillRect(x, -.24, .096, .48);
    ctx.strokeStyle = '#3a3229'; ctx.lineWidth = .023; ctx.strokeRect(x, -.24, .096, .48);
    ctx.fillStyle = '#ead7b05c'; ctx.fillRect(x + .013, -.22, .024, .43);
  }
}

function leaf(ctx: CanvasRenderingContext2D, x: number, length: number, tones: readonly string[], bands: number) {
  const material = ctx.createLinearGradient(x, -.14, x + .03, .14);
  material.addColorStop(0, tones[0]); material.addColorStop(.25, tones[1]); material.addColorStop(1, tones[2]);
  ctx.fillStyle = material; ctx.fillRect(x, -.125, length, .25);
  ctx.strokeStyle = '#332b23'; ctx.lineWidth = .035; ctx.strokeRect(x, -.125, length, .25);
  ctx.strokeStyle = '#392b217d'; ctx.lineWidth = .016; ctx.beginPath();
  for (let p = x + .09; p < x + length - .02; p += .09) { ctx.moveTo(p, -.1); ctx.lineTo(p, .105); }
  ctx.stroke();
  ctx.fillStyle = '#4d5144';
  for (let i = 0; i < bands; i++) ctx.fillRect(x + (length * (i + .5)) / bands - .02, -.133, .04, .265);
}

/**
 * Рисует дверь заданного вида. Координаты — в клетках, проём вдоль локальной
 * горизонтали (как у drawDoor). Обычная дверь рисуется прежним drawDoor.
 */
export function drawDoorKind(ctx: CanvasRenderingContext2D, kind: DoorKind, style: DoorStyle, opened: boolean, showSecrets: boolean) {
  if (kind === 'normal') { drawDoor(ctx, style, .96, opened); return; }
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const wood = ['#b99460', '#91663e', '#5f4029'] as const;
  const iron = ['#798076', '#555d53', '#3f473f'] as const;
  if (kind === 'double' || kind === 'gate') {
    // Две створки от противоположных петель; ворота — окованные, шире рамы.
    const gate = kind === 'gate';
    frame(ctx, gate ? '#a69a80' : '#987449');
    ctx.fillStyle = '#28251f'; ctx.fillRect(-.38, -.10, .76, .2);
    leaf(ctx, -.384, .38, gate ? iron : wood, gate ? 2 : 1);
    leaf(ctx, .004, .38, gate ? iron : wood, gate ? 2 : 1);
    ctx.fillStyle = '#ddd2aa';
    for (const x of [-.03, .034]) { ctx.beginPath(); ctx.arc(x, 0, .02, 0, Math.PI * 2); ctx.fill(); }
    if (gate) {
      ctx.fillStyle = '#c9c3a6';
      for (let x = -.33; x < .36; x += .11) for (const y of [-.075, .075]) { ctx.beginPath(); ctx.arc(x, y, .013, 0, Math.PI * 2); ctx.fill(); }
    }
  } else if (kind === 'arch') {
    // Открытая арка: каменные пилоны и замковый камень, створки нет.
    frame(ctx, '#a69a80');
    ctx.fillStyle = '#9c917a'; ctx.strokeStyle = '#4a4338'; ctx.lineWidth = .022;
    for (let i = 0; i < 7; i++) {
      const x = -.39 + i * .112;
      ctx.beginPath(); ctx.rect(x, -.235, .1, .07); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(x, .165, .1, .07); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#c1b391'; ctx.beginPath(); ctx.rect(-.06, -.26, .12, .1); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(-.06, .16, .12, .1); ctx.fill(); ctx.stroke();
  } else if (kind === 'portcullis') {
    frame(ctx, '#8d8a7c');
    ctx.fillStyle = '#18201d'; ctx.fillRect(-.38, -.11, .76, .22);
    ctx.strokeStyle = '#a0a28c'; ctx.lineWidth = .036; ctx.beginPath();
    for (let x = -.33; x < .36; x += .085) { ctx.moveTo(x, -.15); ctx.lineTo(x, .15); }
    ctx.moveTo(-.38, -.05); ctx.lineTo(.38, -.05); ctx.moveTo(-.38, .05); ctx.lineTo(.38, .05);
    ctx.stroke();
    ctx.fillStyle = '#c9c3a6';
    for (let x = -.33; x < .36; x += .085) { ctx.beginPath(); ctx.moveTo(x - .02, .15); ctx.lineTo(x + .02, .15); ctx.lineTo(x, .2); ctx.fill(); }
  } else if (kind === 'broken') {
    // Выбитая: рама на месте, створка сорвана с петель и лежит наискось, щепки.
    frame(ctx, '#7f6a4c');
    ctx.save(); ctx.translate(-.1, .06); ctx.rotate(.5);
    leaf(ctx, -.3, .56, ['#9d815a', '#7a5b39', '#4f3726'], 1);
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = .03; ctx.beginPath(); ctx.moveTo(.05, -.12); ctx.lineTo(.12, 0); ctx.lineTo(.06, .12); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#b48d5c'; ctx.lineWidth = .025; ctx.beginPath();
    for (const [x, y, a] of [[.22, -.12, .4], [.3, .1, -.7], [-.32, -.14, 1.1], [.12, .16, .2]]) { ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * .09, y + Math.sin(a) * .09); }
    ctx.stroke();
  } else if (kind === 'blocked') {
    // Завал: груда камней поперёк проёма.
    frame(ctx, '#8d8573');
    const stones: [number, number, number][] = [[-.3, .02, .13], [-.1, -.06, .15], [.12, .05, .14], [.31, -.03, .12], [0, .12, .1], [-.2, -.15, .09], [.22, -.15, .08]];
    for (const [x, y, r] of stones) {
      ctx.fillStyle = '#857f70'; ctx.strokeStyle = '#3f3b33'; ctx.lineWidth = .025;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + x * 7; const rr = r * (.8 + ((k * 37 + Math.round(x * 100)) % 5) * .05); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * .85); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b3ac98'; ctx.beginPath(); ctx.arc(x - r * .3, y - r * .3, r * .25, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'secret') {
    // Потайная: снаружи выглядит кладкой; с включёнными метками — пунктир и знак.
    ctx.fillStyle = '#6f6a5e'; ctx.fillRect(-.5, -.2, 1, .4);
    ctx.strokeStyle = '#3b372f'; ctx.lineWidth = .02; ctx.beginPath();
    ctx.moveTo(-.5, 0); ctx.lineTo(.5, 0);
    for (const x of [-.25, .25]) { ctx.moveTo(x, -.2); ctx.lineTo(x, 0); }
    for (const x of [-.45, 0, .45]) { ctx.moveTo(x, 0); ctx.lineTo(x, .2); }
    ctx.stroke();
    if (showSecrets) {
      ctx.strokeStyle = '#e8c86a'; ctx.lineWidth = .035; ctx.setLineDash([.06, .05]);
      ctx.strokeRect(-.44, -.17, .88, .34); ctx.setLineDash([]);
      ctx.font = 'bold .24px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f2d77c'; ctx.fillText('S', 0, .01);
    }
  }
  ctx.restore();
}
