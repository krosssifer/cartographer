import { artPick } from './assets';
import { FURNITURE, FURNITURE_FINISHES, furnitureArt } from './furnitureKit';
import { spriteImage } from './furnitureImport';
import { doorStyle, drawDoor, type DoorStyle } from './doors';
import { facingOf, interiorOf, type Partition, type Room } from './interiors';
import { hash2 } from './random';
import { spriteLook } from './spriteLook';
import { tinted } from './tintCache';
import type { Building, FurnitureSprite, Furnishing, Point } from './types';

type Material = (name: string, scale: number, rotate?: boolean) => CanvasPattern | null;

function roomFloor(ctx: CanvasRenderingContext2D, room: Room, seed: number, texture: Material) {
  const { x, y, w, h, kind } = room;
  const stone = kind === 'kitchen' || kind === 'pantry' || kind === 'workshop';
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = stone ? '#978479' : kind === 'common' ? '#b18a5e' : kind === 'bedroom' || kind === 'guest' ? '#a4835f' : '#ab8762';
  ctx.fillRect(x, y, w, h);
  const pattern = texture(stone ? 'flagstone' : 'timber', stone ? 3.9 : 4.9, !stone);
  if (pattern) { ctx.globalAlpha = stone ? .43 : .25; ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
  if (!stone) {
    for (let i = 0; i < Math.ceil(h / .235); i++) {
      const yy = y + i * .235;
      const stagger = hash2(i, 10, seed) * 1.4;
      for (let j = -1; j < w / 1.48 + 1; j++) {
        const xx = x + j * 1.48 + stagger;
        const v = hash2(i, j, seed + 593);
        ctx.fillStyle = v > .49 ? `rgba(249,218,155,${(v - .49) * .29})` : `rgba(61,33,21,${(.49 - v) * .29})`;
        ctx.fillRect(xx, yy, 1.48, .235);
        ctx.strokeStyle = '#4e362a8e'; ctx.lineWidth = .019;
        ctx.beginPath(); ctx.moveTo(xx + 1.485, yy); ctx.lineTo(xx, yy); ctx.lineTo(xx, yy + .235); ctx.stroke();
        ctx.strokeStyle = '#f0c89758'; ctx.lineWidth = .016;
        ctx.beginPath(); ctx.moveTo(xx + .019, yy + .025); ctx.lineTo(xx + 1.47, yy + .025); ctx.stroke();
        if (v > .63) {
          ctx.strokeStyle = '#553b2680'; ctx.lineWidth = .014;
          ctx.beginPath(); ctx.moveTo(xx + .15, yy + .12); ctx.bezierCurveTo(xx + .56, yy + .123, xx + .48, yy + .071, xx + 1.19, yy + .133); ctx.stroke();
        }
      }
    }
  }
  const light = ctx.createLinearGradient(x, y, x + w * .72, y + h);
  light.addColorStop(0, '#fff0c328'); light.addColorStop(.25, '#fff0c309'); light.addColorStop(1, '#372a2726');
  ctx.fillStyle = light; ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function object(ctx: CanvasRenderingContext2D, item: Furnishing, shade: boolean, gallery: Record<string, FurnitureSprite>) {
  const { kind, x, y, rotation } = item;
  const spec = { ...FURNITURE[kind], ...item.size }, custom = item.sprite && gallery[item.sprite];
  const look = spriteLook(x + 11.4, y + 6.8, 61, !custom);
  const art = (custom ? spriteImage(custom) : undefined) ?? artPick(furnitureArt(kind), look.variant);
  ctx.save(); ctx.translate(x, y);
  if (shade && (kind === 'hearth' || kind === 'lantern')) {
    const glow = ctx.createRadialGradient(0, 0, .12, 0, 0, kind === 'hearth' ? 1.04 : .63);
    glow.addColorStop(0, '#f9a65373'); glow.addColorStop(1, '#f9a65300');
    ctx.fillStyle = glow; ctx.fillRect(-1.05, -1.05, 2.1, 2.1);
  }
  ctx.rotate(rotation * Math.PI / 180);
  if (shade && !spec.flat) {
    ctx.save(); ctx.translate(.052, .086); ctx.scale(spec.w * .60, spec.h * .63);
    const fade = ctx.createRadialGradient(0, 0, .35, 0, 0, 1);
    fade.addColorStop(0, '#211a157d'); fade.addColorStop(.63, '#211a154d'); fade.addColorStop(1, '#211a1500');
    ctx.fillStyle = fade; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  if (art) {
    const finish = FURNITURE_FINISHES[item.finish ?? 'oak'].filter;
    // Отделка и оттенок применяются один раз в кэше спрайтов, а не через ctx.filter на каждый предмет.
    const sprite = tinted(art, custom ? finish : [finish, look.filter].filter(Boolean).join(' '));
    if (!custom && look.flipX) ctx.scale(-1, 1);
    const w = custom ? Math.min(spec.w, spec.h * custom.ratio) : spec.w;
    const h = custom ? Math.min(spec.h, spec.w / custom.ratio) : spec.h;
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
  }
  else { ctx.fillStyle = spec.flat ? '#a3684a' : '#7d5639'; ctx.fillRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h); }
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point, style: string, width: number, shift = 0) {
  ctx.strokeStyle = style; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(a.x + shift, a.y + shift); ctx.lineTo(b.x + shift, b.y + shift); ctx.stroke();
}

function wall(ctx: CanvasRenderingContext2D, { from, to, doorway }: Partition, wood: boolean, outside: boolean, door: DoorStyle) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
  const d = (doorway.x - from.x) * dx + (doorway.y - from.y) * dy;
  const at = (v: number) => ({ x: from.x + v * dx, y: from.y + v * dy });
  const half = outside ? .46 : .40, hasDoor = d > 0 && d < length;
  const spans = hasDoor ? [[0, Math.max(0, d - half)], [Math.min(length, d + half), length]] : [[0, length]];
  for (const [a, b] of spans) if (b > a + .025) {
    line(ctx, at(a), at(b), '#31251e56', outside ? .36 : .26, .052);
    line(ctx, at(a), at(b), '#3c2e25', outside ? .25 : .17);
    line(ctx, at(a), at(b), wood ? '#a77e53' : '#a69a82', outside ? .164 : .106, -.02);
    line(ctx, at(a), at(b), wood ? '#dab787' : '#d4c4a4', .036, -.038);
    if (outside) for (let p = a + .36; p < b - .12; p += wood ? .90 : .33) {
      const j = at(p);
      line(ctx, { x: j.x - dy * .095, y: j.y - dx * .095 }, { x: j.x + dy * .077, y: j.y + dx * .077 }, '#524337', wood ? .066 : .024);
    }
  }
  if (hasDoor) {
    ctx.save(); ctx.translate(doorway.x, doorway.y); ctx.rotate(Math.atan2(dy, dx));
    drawDoor(ctx, door, outside ? .92 : .80, !outside);
    ctx.restore();
  }
}

/** Один предмет мебели в координатах дома (клетки): используется «призраком» при перетаскивании. */
export function drawFurnishing(ctx: CanvasRenderingContext2D, item: Furnishing, shading: boolean, furnitureSprites: FurnitureSprite[] = []) {
  object(ctx, item, shading && !FURNITURE[item.kind].flat, Object.fromEntries(furnitureSprites.map((sprite) => [sprite.id, sprite])));
}

export function drawInterior(ctx: CanvasRenderingContext2D, b: Building, seed: number, material: Material, shading: boolean, gallery: Record<string, FurnitureSprite>) {
  const plan = interiorOf(b), wood = b.style === 'village' || b.kind === 'tavern';
  for (const [index, room] of plan.rooms.entries()) roomFloor(ctx, room, seed + index * 3151, material);
  for (const item of plan.furnishings) if (FURNITURE[item.kind].flat) object(ctx, item, false, gallery);
  for (const item of plan.furnishings) if (!FURNITURE[item.kind].flat) object(ctx, item, shading, gallery);
  ctx.lineCap = 'butt';
  for (const [i, p] of plan.walls.entries()) wall(ctx, p, wood, false, doorStyle(b.style, b.x + i, b.y, seed));
  const facing = facingOf(b);
  const exterior: [Point, Point, number][] = [
    [{ x: 0, y: 0 }, { x: b.w, y: 0 }, 180], [{ x: b.w, y: 0 }, { x: b.w, y: b.h }, 270],
    [{ x: 0, y: b.h }, { x: b.w, y: b.h }, 0], [{ x: 0, y: 0 }, { x: 0, y: b.h }, 90],
  ];
  for (const [from, to, side] of exterior) {
    const vertical = from.x === to.x;
    wall(ctx, { from, to, doorway: side === facing ? plan.entrance : { x: from.x + (vertical ? 0 : -2), y: from.y + (vertical ? -2 : 0) } }, wood, true, b.kind === 'tavern' ? 'carved' : doorStyle(b.style, b.x, b.y, seed));
    if (b.w * b.h < 10) continue;
    for (const t of b.kind === 'tavern' && !vertical ? [.21, .73] : [.64]) {
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
      if (Math.hypot(x - plan.entrance.x, y - plan.entrance.y) < .95) continue;
      line(ctx, { x: x - (vertical ? 0 : .29), y: y - (vertical ? .29 : 0) }, { x: x + (vertical ? 0 : .29), y: y + (vertical ? .29 : 0) }, '#42362b', .16);
      line(ctx, { x: x - (vertical ? 0 : .24), y: y - (vertical ? .24 : 0) }, { x: x + (vertical ? 0 : .24), y: y + (vertical ? .24 : 0) }, '#b4c8b3', .075);
    }
  }
}