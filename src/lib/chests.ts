import { centeredBounds, footprintCells } from './objectGeometry';
import { contains, encloses, intersects } from './settlementKit';
import { CRYPT } from './cryptKit';
import { interiorOf } from './interiors';
import { furnitureBounds, FURNITURE } from './furnitureKit';
import type { Chest, ChestKind, MapData } from './types';

export const CHESTS: Record<ChestKind, { label: string; art: string; w: number; h: number; note: string }> = {
  wooden: { label: 'Деревянный', art: 'chest-wooden', w: .95, h: .66, note: 'Дуб и железные скобы' },
  stone: { label: 'Каменный', art: 'chest-stone', w: 1.1, h: .76, note: 'Резной камень и бронза' },
  ornate: { label: 'Роскошный', art: 'chest-ornate', w: 1.1, h: .76, note: 'Золото, резьба и самоцвет' },
};
export const CHEST_KINDS = Object.keys(CHESTS) as ChestKind[];
export const chestDimensions = (chest: Chest) => chest.size ?? (chest.kind ? { w: CHESTS[chest.kind].w, h: CHESTS[chest.kind].h } : { w: .93, h: .645 });
export const chestBounds = (chest: Chest) => centeredBounds(chest, chestDimensions(chest), chest.rotation);
export const chestArt = (chest: Pick<Chest, 'kind'>) => chest.kind ? CHESTS[chest.kind].art : 'chest';

export function canPlaceChest(map: MapData, chest: Chest, skip = -1) {
  const rect = chestBounds(chest);
  if (!encloses({ x: 0, y: 0, w: map.width, h: map.height }, rect)) return false;
  if (!footprintCells(rect, (x, y) => {
    const t = map.cells[y]?.[x]?.terrain;
    return !!t && !['water', 'deepWater', 'wall', 'void', 'caveWall', 'door', 'buildingWall'].includes(t);
  })) return false;
  if (map.crypt?.some((p) => CRYPT[p.kind].blocks && intersects(p, rect))) return false;
  if (map.chests.some((c, i) => i !== skip && intersects(chestBounds(c), rect))) return false;
  const building = map.buildings?.find((b) => contains(b, chest.x, chest.y));
  if (!building) return true;
  const local = { ...rect, x: rect.x - building.x, y: rect.y - building.y };
  const plan = interiorOf(building);
  return plan.rooms.some((r) => encloses({ x: r.x + .15, y: r.y + .15, w: r.w - .3, h: r.h - .3 }, local))
    && ![plan.entrance, ...plan.walls.map((wall) => wall.doorway)].some(({ x, y }) => intersects(local, { x: x - .4, y: y - .4, w: .8, h: .8 }))
    && !plan.furnishings.some((item) => !FURNITURE[item.kind].flat && intersects(furnitureBounds(item), local));
}

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180" viewBox="0 0 260 180"><defs><linearGradient id="oak" x2=".2" y2="1"><stop stop-color="#c29256"/><stop offset=".4" stop-color="#a06c3c"/><stop offset="1" stop-color="#674023"/></linearGradient><linearGradient id="stone" x2=".3" y2="1"><stop stop-color="#c9c0a6"/><stop offset=".4" stop-color="#969a8a"/><stop offset="1" stop-color="#555b55"/></linearGradient><linearGradient id="wood" x2=".1" y2="1"><stop stop-color="#93604d"/><stop offset=".4" stop-color="#703e31"/><stop offset="1" stop-color="#3a2424"/></linearGradient><linearGradient id="gold" x2=".5" y2="1"><stop stop-color="#f1d491"/><stop offset=".45" stop-color="#c4964d"/><stop offset="1" stop-color="#775733"/></linearGradient><radialGradient id="gem" cx=".3" cy=".3"><stop stop-color="#d0e4c2"/><stop offset=".4" stop-color="#509e9a"/><stop offset="1" stop-color="#235459"/></radialGradient></defs><g stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`)}`;
const rivets = [46, 198].map((x) => [40, 65, 98, 131].map((y) => `<circle cx="${x}" cy="${y}" r="2.9" fill="#a7a18c" stroke="#3b3329" stroke-width="1.2"/>`).join('')).join('');
const grain = `<path d="M30 42h174m-174 28h169M29 98h181M30 125h179" stroke="#492f20" stroke-width="2.1"/><path d="m70 55 59 2 43-4m-95 30 49-2m29 6 26-1M63 113l41-3 49 3 27-3M86 35l48-2" fill="none" stroke="#dfad736b" stroke-width="1.8"/><path d="M83 63q7-8 14 0t14 0m45 54q12-7 16 0" fill="none" stroke="#53331f" stroke-width="1.4"/>`;
export const chestVectors: Record<string, string> = {
  'chest-wooden': svg(`<path d="m19 31 17-13h183l22 16v110l-17 14H34l-17-14z" fill="#442e20" stroke="#35261e" stroke-width="4"/><path d="M24 38q0-14 15-17h175q17 2 21 18v99H24z" fill="url(#oak)" stroke="#4c3423" stroke-width="3"/>${grain}<path d="M24 137h211v9H24z" fill="#795133"/><path d="M39 22h15v122H39zm151 0h16v122h-16z" fill="#68614f" stroke="#3b332a" stroke-width="2.8"/>${rivets}<path d="M119 123h26v30h-26z" fill="#847b5b" stroke="#35271d" stroke-width="3"/><path d="M132 133v12" stroke="#2d261e" stroke-width="4"/><path d="M25 30q12-8 24-6m8 0h157" fill="none" stroke="#eed0a479" stroke-width="2.1"/>`),
  'chest-stone': svg(`<path d="m18 32 19-17h181l23 19v111l-18 15H35l-20-16z" fill="#464d46" stroke="#30362f" stroke-width="4"/><path d="M19 35 39 19h174l22 17v99H19z" fill="url(#stone)" stroke="#4e5348" stroke-width="3"/><path d="m34 38 12-9h159l13 9v82H34z" fill="none" stroke="#d9d4bd" stroke-width="4"/><path d="M42 43h169v68H42z" fill="#878b7a" stroke="#545c51" stroke-width="2"/><path d="m56 77 31-23 33 24 32-24 42 23-42 24-32-23-33 23z" fill="none" stroke="#b9b59a" stroke-width="3"/><path d="m39 26 13 15-4 18 15 6m144 34-13 11 6 17m-76-98 9 13-8 11" stroke="#565c50" stroke-width="2.8" fill="none"/><path d="M23 128h209v12H23z" fill="#636e5e" stroke="#364039" stroke-width="2"/><path d="M112 119h37v36h-37z" fill="#6b8b73" stroke="#394f43" stroke-width="3"/><path d="m120 127 21 1-10 17z" fill="#b3a574" stroke="#414b38" stroke-width="2"/><path d="m26 34 15-11h166" stroke="#e2deccaa" stroke-width="2.7" fill="none"/>`),
  'chest-ornate': svg(`<path d="m13 35 15-19h203l17 20v111l-17 13H29l-17-16z" fill="#352126" stroke="#291e1c" stroke-width="4"/><path d="M20 35q8-17 24-18h171q20 2 25 20v102H20z" fill="url(#wood)" stroke="#bc9154" stroke-width="4"/><path d="M28 43h204m-204 29h204m-204 29h204m-204 28h204" stroke="#351f20" stroke-width="2"/><path d="M34 22h17v119H34zm175 0h17v119h-17zM21 127h219v17H21z" fill="url(#gold)" stroke="#67482b" stroke-width="2.7"/><path d="M58 29q23 14 7 35-13 14 2 28t-2 29m22-85q24 6 10 23t-2 32 1 26m103-86q-23 14-7 35 13 14-2 28t2 29m-22-85q-24 6-10 23t2 32-1 26" fill="none" stroke="#d7b777" stroke-width="2.5"/><path d="m113 29 17-9 18 9-6 11h-22zM26 30l21-5 6 19-19-2zm189-5 20 7-7 13-20-2z" fill="url(#gold)" stroke="#684a2e" stroke-width="2"/><path d="m113 116 17-7 18 7 5 29-23 13-22-13z" fill="url(#gold)" stroke="#65472e" stroke-width="3"/><path d="m130 119 11 13-11 13-10-13z" fill="url(#gem)" stroke="#edce84" stroke-width="2"/><path d="m71 54 8 9-8 9-7-9zm118 0 8 9-8 9-7-9z" fill="url(#gem)" stroke="#d4b178" stroke-width="2"/><path d="M56 29h44m57 0h46M30 148h198" fill="none" stroke="#f5d7a177" stroke-width="2"/>`),
};