import { artPick, getAssets } from './assets';
import { CRYPT, coversHazard, cryptArt, hazard, isSecret } from './cryptKit';
import { hash2 } from './random';
import { spriteLook } from './spriteLook';
import type { CryptObject, MapData, RenderSettings } from './types';

export function cryptPainter(ctx: CanvasRenderingContext2D, map: MapData, settings: RenderSettings, seed: number) {
  const grid = settings.cellSize;
  const items = (map.crypt ?? []).filter((item) => !isSecret(item) || settings.showSecrets);
  const art = getAssets().art;
  const rock = art.bedrock;
  let stone: CanvasPattern | null = null;
  if (rock && settings.texture) {
    stone = ctx.createPattern(rock, 'repeat');
    stone?.setTransform(new DOMMatrix().scale(3.15 / rock.naturalWidth));
  }

  function glow(x: number, y: number, r: number, color: string, center: number, middle = center / 2) {
    ctx.save(); ctx.translate(x, y); ctx.scale(r, r);
    const halo = ctx.createRadialGradient(0, 0, .1, 0, 0, 1);
    halo.addColorStop(0, `rgba(${color},${center})`);
    halo.addColorStop(.45, `rgba(${color},${middle})`);
    halo.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = halo; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }

  function depth() {
    if (map.biome !== 'dungeon' || !settings.shading) return;
    ctx.save(); ctx.scale(grid, grid);
    ctx.fillStyle = '#12141a'; ctx.globalAlpha = .25;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.cells[y][x].terrain === 'void') ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = '#201c22'; ctx.globalAlpha = .16;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.cells[y][x].terrain === 'floor') ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
    for (const room of map.cryptRooms ?? []) {
      if (room.theme === 'archive' || room.theme === 'reliquary') {
        ctx.fillStyle = room.theme === 'archive' ? '#794d2623' : '#28595527';
        ctx.fillRect(room.x, room.y, room.w, room.h);
      }
      if (room.theme !== 'sanctum') continue;
      ctx.save(); ctx.translate(room.x, room.y);
      const frame = ctx.createLinearGradient(0, 0, room.w, room.h);
      frame.addColorStop(0, '#928b713b'); frame.addColorStop(1, '#3f6e6830');
      ctx.strokeStyle = frame; ctx.lineWidth = .075;
      ctx.strokeRect(.43, .43, room.w - .86, room.h - .86);
      ctx.strokeStyle = '#7c8f8134'; ctx.lineWidth = .04;
      ctx.strokeRect(.63, .63, room.w - 1.26, room.h - 1.26);
      ctx.restore();
    }
    ctx.restore();
  }

  function chasm(item: CryptObject) {
    const { w, h, variant } = item;
    const sides = Math.max(14, Math.round((w + h) * 4));
    function silhouette(scale: number, offsetX = 0, offsetY = 0) {
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2;
        const k = .84 + hash2(i, item.x + item.y * 93, seed + variant) * .15;
        const x = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** .62;
        const y = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** .62;
        const px = w / 2 + x * (w / 2 - .045) * k * scale + offsetX;
        const py = h / 2 + y * (h / 2 - .046) * k * scale + offsetY;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    }
    silhouette(.992, .02, .095); ctx.fillStyle = '#211d1c'; ctx.fill();
    silhouette(1); ctx.fillStyle = stone ?? '#777164'; ctx.fill();
    ctx.lineWidth = .052; ctx.strokeStyle = '#b2a891'; ctx.stroke();
    silhouette(.85, -.035, -.027);
    const fog = ctx.createRadialGradient(w * .47, h * .51, .18, w * .47, h * .51, Math.max(w, h) * .59);
    fog.addColorStop(0, '#131f23'); fog.addColorStop(.52, '#10151a'); fog.addColorStop(.88, '#403a35'); fog.addColorStop(1, '#61594e');
    ctx.fillStyle = fog; ctx.fill(); ctx.lineWidth = .083; ctx.strokeStyle = '#312c2b'; ctx.stroke();
    silhouette(.68); ctx.strokeStyle = '#93928528'; ctx.lineWidth = .055; ctx.stroke();
    ctx.save(); silhouette(.65); ctx.clip(); glow(w * .40, h * .57, Math.max(w, h) * .47, '64,112,109', .18); ctx.restore();
    for (let i = 0; i < sides; i++) {
      const a = i / sides * 6.28318;
      const x = Math.cos(a), y = Math.sin(a);
      const rim = .84 + hash2(i, variant + 781, seed) * .13;
      ctx.strokeStyle = i % 2 ? '#bab09774' : '#3e373170'; ctx.lineWidth = .021;
      ctx.beginPath(); ctx.moveTo(w / 2 + x * w * .47 * rim, h / 2 + y * h * .47 * rim);
      ctx.lineTo(w / 2 + x * w * .38 * rim - .05, h / 2 + y * h * .41 * rim + .03); ctx.stroke();
    }
  }

  function prop(item: CryptObject) {
    const { x, y, w, h, kind, rotation } = item;
    const spec = CRYPT[kind];
    ctx.save(); ctx.scale(grid, grid); ctx.translate(x, y);
    if (kind === 'chasm') { chasm(item); ctx.restore(); return; }
    if (settings.shading) {
      if (kind === 'brazier' || kind === 'candles' || kind === 'altar') glow(w / 2, h / 2, kind === 'brazier' ? 1.8 : 1.15, '238,151,64', .30);
      if (kind === 'runeCircle') glow(w / 2, h / 2, 1.7, '46,166,153', .28);
      if (kind === 'mushroomsGlow') glow(w / 2, h / 2, .95, '62,190,170', .22);
      if (kind === 'crystals') glow(w / 2, h / 2, .9, '120,190,220', .20);
      if (kind === 'puddleAcid') glow(w / 2, h / 2, .8, '80,180,90', .15);
      if (kind === 'runeBlue' || kind === 'runeCircleBlue') glow(w / 2, h / 2, Math.max(w, h) * .55, '90,190,230', .22);
      if (kind === 'runeCirclePurple') glow(w / 2, h / 2, Math.max(w, h) * .55, '170,110,220', .22);
      if (kind === 'greenRuneStone') glow(w / 2, h / 2, .8, '90,220,120', .18);
      if (kind === 'orbRed') glow(w / 2, h / 2, .9, '220,70,70', .18);
      if (!spec.flat && !hazard(kind)) glow(w * .53, h * .61, Math.max(w, h) * .60, '16,13,13', .54, .31);
    }
    const rotate = rotation % 180 !== 0;
    const wide = (rotate ? h : w), tall = (rotate ? w : h);
    const look = spriteLook(x * 0.5 + 5.1, y * 0.5 + 3.3, 53);
    const img = artPick(cryptArt(kind), look.variant);
    ctx.translate(w / 2, h / 2); ctx.rotate(rotation * Math.PI / 180);
    if (look.flipX) ctx.scale(-1, 1);
    const cover = coversHazard(kind);
    const fitW = wide * (cover ? 1.21 : spec.secret ? .78 : kind === 'pit' ? 1.01 : .90);
    const fitH = tall * (cover ? .97 : spec.secret ? .78 : kind === 'pit' ? 1.01 : .90);
    if (img) {
      if (kind === 'runeCircle') ctx.globalAlpha = .69;
      else if (spec.secret) ctx.globalAlpha = .86;
      else if (kind === 'rug') { ctx.globalAlpha = .83; ctx.filter = 'saturate(.72) brightness(.83)'; }
      else if (look.filter) ctx.filter = look.filter;
      if (!cover && !spec.secret && !['steps', 'web'].includes(kind)) {
        const k = Math.min(fitW / img.naturalWidth, fitH / img.naturalHeight);
        ctx.drawImage(img, -img.naturalWidth * k / 2, -img.naturalHeight * k / 2, img.naturalWidth * k, img.naturalHeight * k);
      } else ctx.drawImage(img, -fitW / 2, -fitH / 2, fitW, fitH);
    } else {
      ctx.fillStyle = '#665f50'; ctx.fillRect(-fitW / 2, -fitH / 2, fitW, fitH);
    }
    if (spec.secret) {
      ctx.globalAlpha = .84;
      ctx.strokeStyle = '#d59c73'; ctx.lineWidth = .030;
      ctx.setLineDash([.077, .069]); ctx.beginPath(); ctx.roundRect(-wide * .43, -tall * .43, wide * .86, tall * .86, Math.min(.08, wide * .14, tall * .14)); ctx.stroke();
    }
    ctx.restore();
  }

  function floorProps() {
    for (const item of items) if (hazard(item.kind)) prop(item);
    for (const item of items) if (!hazard(item.kind) && CRYPT[item.kind].flat) prop(item);
  }
  function lights() {
    if (!settings.shading || !items.length) return;
    ctx.save(); ctx.scale(grid, grid); ctx.beginPath();
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const t = map.cells[y][x].terrain;
      if (t === 'floor' || t === 'door') ctx.rect(x, y, 1, 1);
    }
    ctx.clip(); ctx.globalCompositeOperation = 'screen';
    for (const item of items) {
      const { x, y, w, h, kind } = item;
      if (kind === 'brazier' || kind === 'altar') glow(x + w / 2, y + h / 2, 2.72, '187,108,43', .27, .11);
      else if (kind === 'runeCircle') glow(x + w / 2, y + h / 2, 2.2, '47,125,116', .22, .11);
      else if (kind === 'candles') glow(x + w / 2, y + h / 2, 1.58, '192,132,63', .18, .07);
    }
    ctx.restore();
  }
  return { depth, floorProps, lights, upright: items.filter((item) => !hazard(item.kind) && !CRYPT[item.kind].flat), prop };
}