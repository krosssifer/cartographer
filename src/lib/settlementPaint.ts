import { getAssets } from './assets';
import { hash2 } from './random';
import { drawLookedFit, spriteLook } from './spriteLook';
import { civicArt, marketStalls, ROOF_KIT } from './settlementKit';
import { DIRECTIONS, facingOf } from './interiors';
import { drawInterior } from './interiorPaint';
import { doorStyle, drawDoor } from './doors';
import type { Building, BuildingAttachment, CivicObject, FurnitureSprite, MapData, RenderSettings } from './types';

/** Диагностика фактической отрисовки городских и рыночных объектов (civic). */
export interface CivicRenderDiagnostics {
  reachedRender: number;
  renderedSprite: number;
  renderedProcedural: number;
  skippedMissingAsset: number;
  skippedByLayerToggle: boolean;
}

const civicRenderDiagMap = new WeakMap<MapData, CivicRenderDiagnostics>();

export function setCivicRenderDiagnostics(map: MapData, diag: CivicRenderDiagnostics): void {
  civicRenderDiagMap.set(map, diag);
}

export function getCivicRenderDiagnostics(map: MapData): CivicRenderDiagnostics | undefined {
  return civicRenderDiagMap.get(map);
}

type Vertex = readonly [number, number];

const SHOP_SIGNS = [
  'signBakery',
  'signButcher',
  'signFishmonger',
  'signApothecary',
  'signHerbalist',
  'signClothier',
  'signGeneralStore',
] as const;

const WORKSHOP_SIGNS = [
  'signCarpenter',
  'signCobbler',
  'signTailor',
  'signForge',
] as const;

const WALL_LANTERN_SPRITES = [
  'lampWallLantern',
  'lampWallTorch',
  'lampHangingLantern',
  'lampHangingCage',
] as const;

const WEAR_AGE_OVERLAYS = [
  'wearMossFooting',
  'wearLichenStone',
  'wearStoneCrackShort',
  'wearMissingMortar',
] as const;

const WEAR_NEGLECT_OVERLAYS = [
  'wearMissingShingles',
  'wearPlasterPeelingSmall',
  'wearPlasterPeelingLarge',
  'wearExposedBrick',
  'wearPatchedPlaster',
  'wearDampStain',
  'wearTimberRot',
  'wearBrokenBoard',
  'wearStoneChips',
  'wearStoneCrackLong',
  'wearFoundationCrack',
] as const;

const PLINTH_VILLAGE_MATS = [
  'matTimberPlanks',
  'matFieldstone',
  'matRubbleStone',
  'matAdobe',
  'matMossyStone',
] as const;

const PLINTH_TOWN_MATS = [
  'matFoundationStone',
  'matHalfTimber',
  'matBrick',
  'matCreamPlaster',
  'matOchrePlaster',
  'matRosePlaster',
  'matWeatheredSandstone',
] as const;

const PLINTH_NOBLE_MATS = [
  'matCutStone',
  'matLimestone',
  'matGranite',
] as const;

const TABLETOP_GOODS = [
  'marketScale',
  'marketCoins',
  'marketLedger',
  'marketSpiceBowls',
  'marketHoneyJars',
  'marketCheeseWheels',
  'marketGlassVials',
  'marketCandleBundles',
  'marketHerbBundles',
  'marketSpiceRack',
] as const;

function pickSignSprite(b: Building, variant = 0): string {
  const role = b.role;
  if (role === 'smithy') return 'signForge';
  if (role === 'stable') return 'signStable';
  if (role === 'temple' || role === 'minor_temple' || role === 'shrine') return 'signTemple';
  if (role === 'guildhall' || role === 'town_hall') return 'signGuild';
  if (role === 'tavern' || b.kind === 'tavern') return variant % 2 === 0 ? 'signTavern' : 'signInn';
  if (role === 'workshop') return WORKSHOP_SIGNS[variant % WORKSHOP_SIGNS.length];
  const idx = Math.abs(Math.round(b.x * 3 + b.y * 5 + variant)) % SHOP_SIGNS.length;
  return SHOP_SIGNS[idx];
}

function pickPlinthMaterial(b: Building, grain: number): string {
  if (b.cityCondition === 'worn' && grain > 0.72) return 'matCharredTimber';
  const role = b.role;
  const wealth = b.patina?.wealth ?? (b.style === 'town' ? 0.55 : 0.35);
  if (role === 'temple' || role === 'town_hall' || role === 'citadel' || role === 'manor' || wealth >= 0.74) {
    return PLINTH_NOBLE_MATS[Math.min(PLINTH_NOBLE_MATS.length - 1, Math.floor(grain * PLINTH_NOBLE_MATS.length))];
  }
  if (b.style === 'village' || role === 'barn' || role === 'shed' || role === 'mill') {
    return PLINTH_VILLAGE_MATS[Math.min(PLINTH_VILLAGE_MATS.length - 1, Math.floor(grain * PLINTH_VILLAGE_MATS.length))];
  }
  return PLINTH_TOWN_MATS[Math.min(PLINTH_TOWN_MATS.length - 1, Math.floor(grain * PLINTH_TOWN_MATS.length))];
}

function trace(ctx: CanvasRenderingContext2D, points: readonly Vertex[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export function settlementPainter(ctx: CanvasRenderingContext2D, settings: RenderSettings, seed: number, furnitureSprites: FurnitureSprite[] = []) {
  const cs = settings.cellSize, art = getAssets().art;
  const patterns = new Map<string, CanvasPattern | null>();
  const gallery = Object.fromEntries(furnitureSprites.map((sprite) => [sprite.id, sprite]));

  function material(name: string, scale: number, rotate = false) {
    if (!settings.texture) return null;
    const key = `${name}:${scale}:${rotate}`;
    if (patterns.has(key)) return patterns.get(key) ?? null;
    const img = art[name];
    const pat = img && ctx.createPattern(img, 'repeat');
    pat?.setTransform(new DOMMatrix().rotate(rotate ? 90 : 0).scale(scale / img.naturalWidth));
    patterns.set(key, pat || null);
    return pat || null;
  }

  function shadow(w: number, h: number, strength: number) {
    if (!settings.shading) return;
    ctx.save();
    ctx.translate(w * .55 + .095, h * .58 + .13);
    ctx.scale(w * .68, h * .69);
    const g = ctx.createRadialGradient(0, 0, .21, 0, 0, 1);
    g.addColorStop(0, `rgba(28,27,18,${strength})`);
    g.addColorStop(.68, `rgba(30,28,20,${strength * .58})`);
    g.addColorStop(1, 'rgba(28,27,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  function building(b: Building) {
    const { w, h } = b;
    const grain = hash2(b.x, b.y, seed + 31817);
    const roof = ROOF_KIT[b.roof];
    ctx.save();
    ctx.translate(b.x * cs, b.y * cs);
    ctx.scale(cs, cs);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const facing = facingOf(b);
    const out: Vertex = DIRECTIONS[facing];
    const doorX = b.door.x - b.x + .5 + out[0] * .44, doorY = b.door.y - b.y + .5 + out[1] * .44;

    if (!settings.showRoofs) {
      shadow(w, h, .63);
      drawInterior(ctx, b, seed, material, settings.shading, gallery);
    } else {
      shadow(w, h, .64);
      ctx.save();
      const vertical = h > w;
      const length = vertical ? h : w, depth = vertical ? w : h;
      if (vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); }
      const x0 = .10, x1 = length - .10, y0 = .065, y1 = depth - .22;
      const mid = y0 + (y1 - y0) * .47;
      const isCross = b.shape === 'cross' && length >= 3 && depth >= 2;
      const isHip = b.shape === 'hip' || b.kind === 'tower';
      const gableEnd = Math.min((y1 - y0) * .37, (x1 - x0) * .25);
      const wingL = x0 + (x1 - x0) * .30, wingR = x0 + (x1 - x0) * .67, wing = (wingL + wingR) * .5;
      const eave = isCross ? y0 + (y1 - y0) * .68 : y1;
      const ridge = isCross ? (y0 + eave) * .5 : mid;
      const base: Vertex[] = isCross
        ? [[x0, y0], [x1, y0], [x1, eave], [wingR, eave], [wingR, y1], [wingL, y1], [wingL, eave], [x0, eave]]
        : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

      // Цоколь и фасадная кромка здания с фактурой материала (Sheet 09: mat*):
      const plinthMat = pickPlinthMaterial(b, grain);
      ctx.save();
      ctx.translate(.05, .13);
      trace(ctx, base);
      ctx.lineWidth = .17;
      ctx.strokeStyle = '#352b20';
      ctx.stroke();
      ctx.fillStyle = material(plinthMat, 2.6) ?? material('bedrock', 2.8) ?? '#90806b';
      ctx.fill();
      ctx.restore();

      const tile = material(roof.art, roof.scale);
      const roofPane = (path: Vertex[], tone: string, sideways = false) => {
        trace(ctx, path);
        ctx.fillStyle = (sideways ? material(roof.art, roof.scale, true) : tile) ?? roof.color;
        ctx.fill();
        ctx.fillStyle = tone;
        ctx.fill();
        ctx.lineWidth = .024;
        ctx.strokeStyle = '#30261993';
        ctx.stroke();
      };
      if (isHip && !isCross) {
        const a: Vertex = [x0 + gableEnd, mid], z: Vertex = [x1 - gableEnd, mid];
        roofPane([[x0, y0], [x1, y0], z, a], '#fff0cd20');
        roofPane([[x0, y1], a, z, [x1, y1]], '#241d2a43');
        roofPane([[x0, y0], a, [x0, y1]], '#fff0cd2c', true);
        roofPane([[x1, y0], [x1, y1], z], '#2b222649', true);
      } else {
        roofPane([[x0, y0], [x1, y0], [x1, ridge], [x0, ridge]], '#fff2cf25');
        roofPane([[x0, ridge], [x1, ridge], [x1, eave], [x0, eave]], '#291e2440');
        if (isCross) {
          roofPane([[wingL, y1], [wingL, eave], [wing, ridge], [wing, y1]], '#f4e1be16', true);
          roofPane([[wing, ridge], [wingR, eave], [wingR, y1], [wing, y1]], '#29232853', true);
        }
      }
      trace(ctx, base);
      ctx.strokeStyle = '#3b2e22';
      ctx.lineWidth = .055;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0 + .03, isCross ? eave : y1);
      ctx.lineTo(x0 + .03, y0 + .03);
      ctx.lineTo(x1 - .04, y0 + .03);
      ctx.strokeStyle = '#ffeecc50';
      ctx.lineWidth = .035;
      ctx.stroke();
      const inset = isHip && !isCross ? gableEnd : .065;
      ctx.beginPath();
      ctx.moveTo(x0 + inset, ridge);
      ctx.lineTo(x1 - inset, ridge);
      if (isCross) { ctx.moveTo(wing, ridge); ctx.lineTo(wing, y1 - .045); }
      ctx.strokeStyle = '#3b2b20b2';
      ctx.lineWidth = .084;
      ctx.stroke();
      ctx.strokeStyle = '#ead6a96e';
      ctx.lineWidth = .027;
      ctx.stroke();

      if (grain > .15 || b.kind === 'hall' || b.kind === 'tavern') {
        const cx = x0 + (x1 - x0) * (grain > .42 ? .73 : .22), cy = ridge - .24;
        ctx.fillStyle = '#241e17a8';
        ctx.fillRect(cx + .065, cy + .073, .32, .34);
        ctx.fillStyle = b.style === 'town' ? '#928372' : '#83745b';
        ctx.fillRect(cx, cy, .27, .31);
        ctx.fillStyle = '#3b3026';
        ctx.fillRect(cx + .057, cy + .055, .155, .186);
        ctx.fillStyle = '#dabd9a';
        ctx.fillRect(cx, cy, .27, .048);
        // Мягкий след сажи вокруг печной трубы (wearSootStreak):
        const soot = art['wearSootStreak'];
        if (soot && settings.texture) {
          ctx.save();
          ctx.globalAlpha = 0.34;
          ctx.drawImage(soot, cx - 0.16, cy - 0.14, 0.58, 0.58);
          ctx.restore();
        }
      }
      if (b.kind === 'hall' || b.kind === 'tavern' || (b.roof === 4 && length > 3)) {
        ctx.fillStyle = '#3e3931';
        ctx.fillRect(x1 - .77, ridge + .22, .40, .41);
        ctx.fillStyle = '#b89d68';
        ctx.fillRect(x1 - .74, ridge + .25, .34, .35);
        ctx.fillStyle = '#675d46';
        ctx.fillRect(x1 - .68, ridge + .31, .22, .23);
      }
      if (b.annex === 'dormer' && length >= 3) {
        const dx0 = x0 + (x1 - x0) * .42;
        ctx.fillStyle = '#31261cb8';
        ctx.fillRect(dx0 - .03, y0 + .12, .56, .34);
        ctx.fillStyle = tile ?? roof.color;
        ctx.fillRect(dx0, y0 + .10, .50, .30);
        ctx.strokeStyle = '#3b2e22';
        ctx.lineWidth = .035;
        ctx.strokeRect(dx0, y0 + .10, .50, .30);
        ctx.fillStyle = '#d9c39a';
        ctx.fillRect(dx0 + .11, y0 + .12, .28, .06);
      }
      if (b.annex === 'wing' && !isCross && length >= 4 && depth >= 3) {
        const wx0 = x0 + (x1 - x0) * .56, wx1 = Math.min(x1 - .25, wx0 + 1.25), wm = (wx0 + wx1) * .5;
        roofPane([[wx0, y1], [wx0, ridge], [wm, ridge], [wm, y1 + .14]], '#f4e1be1c', true);
        roofPane([[wm, ridge], [wx1, ridge], [wx1, y1], [wm, y1 + .14]], '#261e244d', true);
      }
      if (b.annex === 'battlement') {
        ctx.fillStyle = '#7d7569';
        ctx.strokeStyle = '#2f2922';
        ctx.lineWidth = .028;
        for (let mx = x0 + .08; mx + .26 <= x1 - .06; mx += .48) {
          ctx.fillRect(mx, y0 - .03, .26, .14); ctx.strokeRect(mx, y0 - .03, .26, .14);
          ctx.fillRect(mx, y1 - .11, .26, .14); ctx.strokeRect(mx, y1 - .11, .26, .14);
        }
        for (let my = y0 + .36; my + .26 <= y1 - .22; my += .48) {
          ctx.fillRect(x0 - .03, my, .14, .26); ctx.strokeRect(x0 - .03, my, .14, .26);
          ctx.fillRect(x1 - .11, my, .14, .26); ctx.strokeRect(x1 - .11, my, .14, .26);
        }
      }

      // Изношенный город: накладные декали повреждений кровли и кладки (Sheet 08: wear*):
      if (b.cityCondition === 'worn') {
        const wearSeed = hash2(b.x, b.y, seed + 0x2103);
        const span = x1 - x0;
        ctx.save();
        trace(ctx, base);
        ctx.clip();
        const patchImg = art['wearBrokenBoard'] ?? art['wearTimberRot'];
        const shingleImg = art['wearMissingShingles'];
        const crackImg = art['wearStoneCrackLong'] ?? art['wearFoundationCrack'];
        if (patchImg && settings.texture) {
          ctx.globalAlpha = 0.72;
          const px = x0 + span * (0.16 + (wearSeed * 0.52));
          const py = ridge + (y1 - ridge) * 0.16;
          ctx.drawImage(patchImg, px, py, Math.min(1.1, span * 0.34), Math.min(0.85, (y1 - ridge) * 0.78));
          if (shingleImg) {
            const sx = x0 + span * (0.52 + ((wearSeed * 3.7) % 0.32));
            ctx.drawImage(shingleImg, sx, y0 + 0.08, Math.min(0.95, span * 0.28), Math.min(0.75, (ridge - y0) * 0.75));
          }
          if (crackImg && wearSeed > 0.45) {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(crackImg, x0 + span * 0.35, ridge - 0.25, 0.75, 0.75);
          }
        } else {
          ctx.fillStyle = 'rgba(26,20,14,0.62)';
          for (let index = 0; index < 3; index += 1) {
            const k = (wearSeed * 7.3 + index * 0.37) % 1;
            const px = x0 + span * (0.12 + k * 0.68);
            const py = ridge + (y1 - ridge) * (0.18 + ((k * 3.1) % 1) * 0.58);
            ctx.fillRect(px, py, 0.32, 0.24);
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }

    if (settings.showRoofs && (b.annex === 'porch' || b.annex === 'awning')) {
      ctx.save();
      ctx.translate(doorX + out[0] * .16, doorY + out[1] * .16);
      if (out[0]) ctx.rotate(Math.PI / 2);
      if (b.annex === 'porch') {
        ctx.fillStyle = '#8b7f6e';
        ctx.strokeStyle = '#352b20';
        ctx.lineWidth = .04;
        ctx.fillRect(-.48, -.20, .96, .40);
        ctx.strokeRect(-.48, -.20, .96, .40);
        ctx.fillStyle = '#6c533b';
        ctx.fillRect(-.42, -.14, .12, .28);
        ctx.fillRect(.30, -.14, .12, .28);
      } else {
        ctx.fillStyle = '#241c1588';
        ctx.fillRect(-.54, -.16, 1.08, .38);
        for (let s = 0; s < 5; s++) {
          ctx.fillStyle = s % 2 === 0 ? '#b54c3b' : '#ead9b7';
          ctx.fillRect(-.52 + s * .208, -.20, .208, .36);
        }
        ctx.strokeStyle = '#3d2a1e';
        ctx.lineWidth = .032;
        ctx.strokeRect(-.52, -.20, 1.04, .36);
      }
      ctx.restore();
    }
    ctx.translate(doorX, doorY);
    if (out[0]) ctx.rotate(Math.PI / 2);
    if (settings.showRoofs) drawDoor(ctx, b.kind === 'tavern' ? 'carved' : doorStyle(b.style, b.x, b.y, seed), b.kind === 'tavern' ? .93 : .78);
    ctx.restore();

    if (settings.showRoofs) {
      drawBuildingPatina(b, grain);
    }
    if (b.kind === 'tavern' && !b.attachments?.some((a) => a.kind === 'tavern_sign')) {
      tavernSign(b, doorX, doorY, out);
    }
    if (settings.showRoofs) {
      if (b.attachments?.length) {
        drawBuildingAttachments(b, b.attachments, doorX, doorY, out);
      } else if (settings.showDecor !== false) {
        // Для классических карт без b.attachments добавляем ненавязчивые фасадные детали только при отрисовке (данные карты неизменны!).
        const implicit = implicitClassicAttachments(b, facing, grain);
        if (implicit.length) drawBuildingAttachments(b, implicit, doorX, doorY, out);
      }
    }
  }

  function implicitClassicAttachments(b: Building, side: BuildingAttachment['side'], grain: number): BuildingAttachment[] {
    const span = side === 0 || side === 180 ? b.w : b.h;
    const out: BuildingAttachment[] = [];
    if (b.kind === 'shop') {
      out.push({ kind: 'shop_sign', side, offset: 0.28, variant: Math.floor(grain * 7) });
      if (span >= 4 && grain > 0.35) out.push({ kind: 'wall_lantern', side, offset: -0.26 });
    } else if (b.kind === 'hall') {
      out.push({ kind: 'wall_lantern', side, offset: -0.25, variant: Math.floor(grain * 4) });
    } else if (b.kind === 'house' && span >= 4 && grain > 0.58) {
      out.push({ kind: 'flower_box', side, offset: 0.26, variant: Math.floor(grain * 3) });
    }
    return out;
  }

  function drawBuildingPatina(b: Building, grain: number) {
    const age = b.patina?.age ?? (grain > 0.76 ? 0.72 : 0.35);
    const maintenance = b.patina?.maintenance ?? 0.65;
    if (age < 0.65 && maintenance > 0.45) return;
    ctx.save();
    ctx.translate(b.x * cs, b.y * cs);
    ctx.scale(cs, cs);
    ctx.beginPath();
    ctx.rect(0.08, 0.06, Math.max(0.4, b.w - 0.16), Math.max(0.4, b.h - 0.22));
    ctx.clip();

    // Древняя кладка/черепица (Old ≠ Poor): мох и лишайник из пакета wear*:
    if (age >= 0.65) {
      const ageName = WEAR_AGE_OVERLAYS[Math.min(WEAR_AGE_OVERLAYS.length - 1, Math.floor(grain * WEAR_AGE_OVERLAYS.length))];
      const mossImg = art[ageName];
      if (mossImg && settings.texture) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.52, 0.24 + (age - 0.6) * 0.65);
        const mw = Math.min(1.35, b.w * 0.42);
        const mh = Math.min(1.1, b.h * 0.38);
        ctx.drawImage(mossImg, b.w * 0.12, b.h * 0.08, mw, mh);
        ctx.restore();
      } else {
        const alpha = Math.min(0.24, (age - 0.55) * 0.42);
        ctx.fillStyle = `rgba(74, 96, 56, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(b.w * 0.34, b.h * 0.28, b.w * 0.24, b.h * 0.14, 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Низкий уход: локальные заплаты кровли и сколы штукатурки (WEAR_NEGLECT_OVERLAYS):
    if (maintenance < 0.45) {
      const negName = WEAR_NEGLECT_OVERLAYS[Math.min(WEAR_NEGLECT_OVERLAYS.length - 1, Math.floor(grain * WEAR_NEGLECT_OVERLAYS.length))];
      const patchImg = art[negName];
      if (patchImg && settings.texture) {
        ctx.save();
        ctx.globalAlpha = 0.62;
        ctx.drawImage(
          patchImg,
          b.w * 0.52,
          b.h * 0.44,
          Math.min(1.05, b.w * 0.32),
          Math.min(0.85, b.h * 0.28),
        );
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(66, 50, 36, 0.32)';
        ctx.strokeStyle = 'rgba(38, 28, 18, 0.45)';
        ctx.lineWidth = 0.03;
        ctx.fillRect(b.w * 0.58, b.h * 0.52, Math.min(0.75, b.w * 0.22), Math.min(0.55, b.h * 0.18));
        ctx.strokeRect(b.w * 0.58, b.h * 0.52, Math.min(0.75, b.w * 0.22), Math.min(0.55, b.h * 0.18));
      }
    }
    ctx.restore();
  }

  function drawBuildingAttachments(b: Building, list: readonly BuildingAttachment[], doorX: number, doorY: number, out: Vertex) {
    const isNight = settings.timeOfDay === 'dusk' || settings.timeOfDay === 'night';
    for (const att of list) {
      if (att.kind === 'tavern_sign') {
        tavernSign(b, doorX, doorY, out, att.variant);
        continue;
      }
      const sVec: Vertex = DIRECTIONS[att.side];
      const tang: Vertex = [-sVec[1], sVec[0]];
      const wallSpan = att.side === 0 || att.side === 180 ? b.w : b.h;
      const wallCenterX = b.w * 0.5 + sVec[0] * (b.w * 0.5 - 0.06);
      const wallCenterY = b.h * 0.5 + sVec[1] * (b.h * 0.5 - 0.06);
      const ax = wallCenterX + tang[0] * att.offset * wallSpan;
      const ay = wallCenterY + tang[1] * att.offset * wallSpan;

      ctx.save();
      ctx.translate((b.x + ax) * cs, (b.y + ay) * cs);
      ctx.scale(cs, cs);
      const rotAngle = Math.atan2(sVec[1], sVec[0]) - Math.PI / 2;
      ctx.rotate(rotAngle);

      if (att.kind === 'awning') {
        if (b.annex !== 'awning') {
          const span = Math.min(1.8, wallSpan * 0.56);
          const palette = [
            ['#b6493a', '#efe0c2'],
            ['#3d6b7d', '#efe4cc'],
            ['#6c7d3d', '#eee2c6'],
            ['#8b5a2b', '#f2e5cb'],
          ][(att.variant ?? 0) % 4];
          ctx.fillStyle = 'rgba(28, 22, 16, 0.42)';
          ctx.fillRect(-span * 0.5 + 0.04, 0.04, span, 0.36);
          const stripes = 5;
          for (let i = 0; i < stripes; i += 1) {
            ctx.fillStyle = i % 2 === 0 ? palette[0] : palette[1];
            ctx.fillRect(-span * 0.5 + (i * span) / stripes, 0, span / stripes, 0.34);
          }
          ctx.strokeStyle = '#38291d';
          ctx.lineWidth = 0.03;
          ctx.strokeRect(-span * 0.5, 0, span, 0.34);
        }
      } else if (att.kind === 'shop_sign') {
        // Кронштейн и специализированная вывеска ремесла/лавки (Sheet 03: sign*):
        const signName = pickSignSprite(b, att.variant ?? 0);
        const look = spriteLook(b.x * 0.1 + 3.1, b.y * 0.1 + 1.7, 47);
        if (!drawLookedFit(ctx, signName, look, 0, 0.30, 0.72, 0.72, { keepAspect: true })
          && !drawLookedFit(ctx, 'urbanSign', look, 0, 0.28, 0.64, 0.64, { keepAspect: true })) {
          ctx.strokeStyle = '#2d2520';
          ctx.lineWidth = 0.055;
          ctx.beginPath();
          ctx.moveTo(0, -0.04);
          ctx.lineTo(0, 0.42);
          ctx.stroke();
          ctx.fillStyle = '#6b472b';
          ctx.strokeStyle = '#dec089';
          ctx.lineWidth = 0.035;
          ctx.beginPath();
          ctx.roundRect(-0.22, 0.12, 0.44, 0.32, 0.05);
          ctx.fill();
          ctx.stroke();
        }
      } else if (att.kind === 'wall_lantern') {
        const glowRadius = isNight ? 0.56 : 0.32;
        const g = ctx.createRadialGradient(0, 0.2, 0.02, 0, 0.2, glowRadius);
        g.addColorStop(0, isNight ? 'rgba(255, 214, 128, 0.88)' : 'rgba(255, 218, 142, 0.34)');
        g.addColorStop(0.55, isNight ? 'rgba(255, 168, 76, 0.3)' : 'rgba(255, 178, 92, 0.1)');
        g.addColorStop(1, 'rgba(255, 168, 76, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0.2, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        const lampName = WALL_LANTERN_SPRITES[(b.x + b.y + (att.variant ?? 0)) % WALL_LANTERN_SPRITES.length];
        const look = spriteLook(b.x * 0.08 + 1.9, b.y * 0.08 + 4.2, 47);
        if (!drawLookedFit(ctx, lampName, look, 0, 0.19, 0.48, 0.48, { keepAspect: true })) {
          ctx.fillStyle = '#2c2623';
          ctx.fillRect(-0.04, -0.02, 0.08, 0.18);
          ctx.fillStyle = '#ffd27d';
          ctx.strokeStyle = '#3a2e22';
          ctx.lineWidth = 0.03;
          ctx.beginPath();
          ctx.arc(0, 0.18, 0.09, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (att.kind === 'flower_box') {
        const greenName = (att.variant ?? 0) % 3 === 2 ? 'greenHangingPlanter' : 'greenWindowBox';
        const look = spriteLook(b.x * 0.07 + 5.1, b.y * 0.07 + 2.3, 47);
        if (!drawLookedFit(ctx, greenName, look, 0, 0.12, 0.78, 0.42, { keepAspect: true })) {
          ctx.fillStyle = '#6c492f';
          ctx.strokeStyle = '#332215';
          ctx.lineWidth = 0.028;
          ctx.fillRect(-0.32, -0.02, 0.64, 0.16);
          ctx.strokeRect(-0.32, -0.02, 0.64, 0.16);
        }
      } else if (att.kind === 'banner') {
        const bannerColor = ['#8d2b2b', '#2b4c7e', '#6a3d7a', '#9c6f27'][(att.variant ?? 0) % 4];
        ctx.strokeStyle = '#caa464';
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        ctx.moveTo(-0.22, 0.02);
        ctx.lineTo(0.22, 0.02);
        ctx.stroke();
        ctx.fillStyle = bannerColor;
        ctx.beginPath();
        ctx.moveTo(-0.16, 0.02);
        ctx.lineTo(0.16, 0.02);
        ctx.lineTo(0.16, 0.34);
        ctx.lineTo(0, 0.24);
        ctx.lineTo(-0.16, 0.34);
        ctx.closePath();
        ctx.fill();
      } else if (att.kind === 'cargo_winch') {
        ctx.strokeStyle = '#4a3520';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(0, -0.1);
        ctx.lineTo(0, 0.38);
        ctx.stroke();
        ctx.fillStyle = '#8b6d4b';
        ctx.beginPath();
        ctx.arc(0, 0.34, 0.09, 0, Math.PI * 2);
        ctx.fill();
      } else if (att.kind === 'shrine_niche') {
        const look = spriteLook(b.x * 0.06 + 2.2, b.y * 0.06 + 6.4, 47);
        if (!drawLookedFit(ctx, 'lampCandleLantern', look, 0, 0.14, 0.44, 0.44, { keepAspect: true })) {
          ctx.fillStyle = '#cfc5b4';
          ctx.strokeStyle = '#5c5346';
          ctx.lineWidth = 0.03;
          ctx.beginPath();
          ctx.arc(0, 0.08, 0.14, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          ctx.arc(0, 0.08, 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function tavernSign(b: Building, x: number, y: number, [dx, dy]: Vertex, variant = 0) {
    ctx.save();
    ctx.translate(b.x * cs, b.y * cs);
    ctx.scale(cs, cs);
    ctx.translate(x + dx * .49 - dy * .51, y + dy * .49 + dx * .51);
    const signSprite = (b.x + b.y + variant) % 2 === 0 ? 'signTavern' : 'signInn';
    const look = spriteLook(b.x * 0.11 + 4.3, b.y * 0.11 + 1.9, 47);
    if (!drawLookedFit(ctx, signSprite, look, 0, 0, 0.92, 0.92, { keepAspect: true })) {
      ctx.beginPath(); ctx.roundRect(-.39, -.38, .89, .86, .17); ctx.fillStyle = '#241d18a0'; ctx.fill();
      ctx.beginPath(); ctx.roundRect(-.43, -.43, .86, .84, .14);
      ctx.fillStyle = '#733f38'; ctx.fill(); ctx.lineWidth = .062; ctx.strokeStyle = '#e2b57c'; ctx.stroke();
      ctx.strokeStyle = '#edc890'; ctx.lineWidth = .061; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(.12, -.1); ctx.quadraticCurveTo(.38, -.16, .29, .06); ctx.lineTo(.12, .14); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(-.22, -.18, .37, .40, .06); ctx.fillStyle = '#e6b773'; ctx.fill();
      ctx.strokeStyle = '#91603f'; ctx.lineWidth = .023; ctx.stroke();
      ctx.fillStyle = '#fff1ce'; ctx.fillRect(-.225, -.21, .38, .10);
    }
    ctx.restore();
  }

  function civic(item: CivicObject): 'sprite' | 'procedural' | 'missing_asset' {
    const { w, h, kind } = item;
    ctx.save();
    ctx.translate(item.x * cs, item.y * cs);
    ctx.scale(cs, cs);
    if (kind === 'square') {
      // Рыночная и гражданская площадь использует собственное парадное мощение (отличное от обычных дорог, §2.6):
      const edge = Math.min(.15, w * .075, h * .075), inset = Math.min(.14, w * .07, h * .07), stroke = Math.min(.1, w * .1, h * .1);
      const radius = Math.min(.55, w * .15, h * .15);
      ctx.beginPath();
      ctx.roundRect(edge, edge, w - edge * 2, h - edge * 2, radius);
      const sqMat = item.variant % 2 === 0
        ? (material('matCutStone', 3.6) ?? material('flagstone', 4.4))
        : (material('matGranite', 3.5) ?? material('cobbles', 4.7));
      ctx.fillStyle = sqMat ?? '#a89d86';
      ctx.fill();
      ctx.fillStyle = item.variant ? '#bf975920' : '#cbb78924';
      ctx.fill();
      ctx.lineWidth = stroke;
      ctx.strokeStyle = '#302c208c';
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(edge + inset, edge + inset, w - edge * 2 - inset * 2, h - edge * 2 - inset * 2, radius * .7);
      ctx.lineWidth = .071;
      ctx.strokeStyle = '#dfc79a92';
      ctx.stroke();
      ctx.restore();
      return 'procedural';
    }
    shadow(w, h, kind === 'market' ? .70 : .61);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(item.rotation * Math.PI / 180);
    const swap = item.rotation === 90 || item.rotation === 270;
    const logicalW = swap ? h : w, logicalH = swap ? w : h;
    let outcome: 'sprite' | 'procedural' | 'missing_asset' = 'sprite';
    const drawSprite = (name: string, x: number, y: number, spanW: number, spanH: number) => {
      const look = spriteLook(item.x * 0.05 + x * 0.02 + 7.3, item.y * 0.05 + y * 0.02 + 2.9, 47);
      if (drawLookedFit(ctx, name, look, x, y, spanW, spanH, { keepAspect: true })) return;
      outcome = kind === 'garden' ? 'procedural' : 'missing_asset';
      ctx.fillStyle = kind === 'well' || kind === 'fountain' ? '#4f7b72' : kind === 'garden' ? '#55613d' : '#a36b4f';
      ctx.beginPath();
      ctx.roundRect(x - spanW / 2, y - spanH / 2, spanW, spanH, .25);
      ctx.fill();
    };
    if (kind === 'market') {
      const normal = marketStalls(logicalW, logicalH, item.variant);
      const columns = logicalW >= 4 ? 2 : 1, rows = logicalH >= 4 ? 2 : 1;
      const sx = logicalW / (columns * 2), sy = logicalH / (rows * 2);
      for (const stall of normal) drawSprite(stall.art, stall.x * sx, stall.y * sy, 1.87 * sx, 1.86 * sy);
    } else {
      drawSprite(civicArt(item), 0, 0, logicalW * .96, logicalH * 1.01);
      // На торговых столах (marketTable / marketTableLong / marketTableSet) раскладываем мелкие товары из Sheet 10:
      if (
        outcome === 'sprite'
        && (kind === 'marketTable' || kind === 'marketTableLong' || kind === 'marketTableSet')
      ) {
        const h1 = Math.floor(hash2(item.x, item.y, seed + 991) * TABLETOP_GOODS.length);
        const h2 = (h1 + 3 + (item.variant % 5)) % TABLETOP_GOODS.length;
        const lookA = spriteLook(item.x * 0.13 + 1.1, item.y * 0.13 + 2.7, 47);
        const lookB = spriteLook(item.x * 0.13 + 4.9, item.y * 0.13 + 6.3, 47);
        drawLookedFit(ctx, TABLETOP_GOODS[h1], lookA, -logicalW * 0.22, -0.04, 0.68, 0.68, { keepAspect: true });
        drawLookedFit(ctx, TABLETOP_GOODS[h2], lookB, logicalW * 0.2, 0.03, 0.66, 0.66, { keepAspect: true });
      }
    }
    ctx.restore();
    return outcome;
  }

  return { building, civic };
}
