import { CRYPT } from '../../cryptKit';
import type { CryptObject, MapData } from '../../types';
import { SCENES } from './scenes';
import { clusterRule } from './clusters';
import { getCondition } from './styles';
import type { ComplexPurpose } from './registry';

export interface DungeonRoomQuality { roomId: string; purpose: string; scenes: number; clusters: number; errors: string[]; warnings: string[] }
export interface DungeonDressingQuality { ok: boolean; errors: string[]; warnings: string[]; rooms: DungeonRoomQuality[] }

/** Audits real scene provenance, not the mere presence of arbitrary props. */
export function validateDungeonDressing(map: MapData): DungeonDressingQuality {
  const objects = map.crypt ?? [], errors: string[] = [], warnings: string[] = [];
  const rooms: DungeonRoomQuality[] = (map.plan?.rooms ?? []).map((r) => ({ roomId: r.id, purpose: r.purpose, scenes: 0, clusters: 0, errors: [], warnings: [] }));
  const roomFor = (x: number, y: number) => {
    const index = (map.plan?.rooms ?? []).findIndex((r) => x >= r.bounds.x && x < r.bounds.x + r.bounds.w && y >= r.bounds.y && y < r.bounds.y + r.bounds.h);
    return index < 0 ? undefined : rooms[index];
  };
  const issue = (severity: 'errors' | 'warnings', message: string, x: number, y: number) => {
    (severity === 'errors' ? errors : warnings).push(message); roomFor(x, y)?.[severity].push(message);
  };
  const groups = new Map<string, CryptObject[]>();
  for (const item of objects) if (item.dungeonScene) {
    const group = item.dungeonScene.groupId;
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  for (const [group, parts] of groups) {
    const meta = parts[0].dungeonScene!;
    const room = roomFor(meta.center.x, meta.center.y);
    if (room && parts.length > 1) room.scenes++;
    if (parts.length === 1) issue('warnings', `${group}: only one scene part; composition is limited`, meta.center.x, meta.center.y);
    const variant = SCENES[meta.purpose as ComplexPurpose]?.find((v) => v.id === meta.variant);
    if (!variant) { issue('errors', `${group}: unknown scene ${meta.variant}`, meta.center.x, meta.center.y); continue; }
    for (let i = 0; i < variant.parts.length; i++) {
      const part = variant.parts[i];
      if (!part.optional && parts.filter((item) => item.dungeonScene?.role === `${group}:${i}` && item.dungeonScene.required).length < (part.count ?? 1))
        issue('errors', `${group}: missing required part ${i}`, meta.center.x, meta.center.y);
    }
    if (!parts.some((item) => item.dungeonScene?.semanticRole === 'anchor')) issue('warnings', `${group}: no semantic anchor`, meta.center.x, meta.center.y);
    for (const item of parts) {
      const m = item.dungeonScene!;
      if (m.variant !== meta.variant || m.purpose !== meta.purpose) issue('errors', `${group}: inconsistent scene identity`, item.x, item.y);
      if (m.attachTo && !parts.some((p) => p.dungeonScene?.role === m.attachTo)) issue('errors', `${group}: missing attachment ${m.attachTo}`, item.x, item.y);
    }
  }
  const clusterIds = new Set<string>();
  const clusters = new Map<string, CryptObject[]>();
  for (const item of objects) {
    const cluster = item.dungeonCluster;
    if (!cluster) continue;
    clusters.set(cluster.id, [...(clusters.get(cluster.id) ?? []), item]);
    if (!clusterIds.has(cluster.id)) { clusterIds.add(cluster.id); const room = roomFor(item.x, item.y); if (room) room.clusters++; }
    if (!objects.some((source) => !source.dungeonCluster && source.kind === cluster.source.kind && source.x === cluster.source.x && source.y === cluster.source.y))
      issue('errors', `${cluster.id}: missing source`, item.x, item.y);
    const condition = map.plan?.dungeon?.complex?.condition;
    const rule = condition ? clusterRule(cluster.source.kind, getCondition(condition)) : undefined;
    if (condition && (!rule || rule.type !== cluster.type || !rule.kinds.includes(item.kind)))
      issue('errors', `${cluster.id}: incompatible source or member`, item.x, item.y);
    if (Math.max(Math.abs(item.x - cluster.source.x), Math.abs(item.y - cluster.source.y), Math.abs(item.x + item.w - 1 - cluster.source.x), Math.abs(item.y + item.h - 1 - cluster.source.y)) > cluster.radius)
      issue('errors', `${cluster.id}: outside radius`, item.x, item.y);
    if (objects.some((scene) => scene.dungeonScene && item.x < scene.x + scene.w && scene.x < item.x + item.w && item.y < scene.y + scene.h && scene.y < item.y + item.h))
      issue('errors', `${cluster.id}: overlaps scene`, item.x, item.y);
  }
  for (const [id, members] of clusters) {
    const first = members[0];
    if (members.length > 2) issue('warnings', `${id}: cluster exceeds intended density`, first.x, first.y);
    if (new Set(members.map((p) => p.kind)).size !== members.length) issue('warnings', `${id}: repeated cluster member`, first.x, first.y);
  }
  const spine = new Set((map.plan?.dungeonDressingDebug?.spine ?? []).map((p) => p.y * map.width + p.x));
  for (const item of objects) if (item.dungeonCluster || (item.dungeonScene && CRYPT[item.kind]?.blocks)) {
    for (let y = item.y; y < item.y + item.h; y++) for (let x = item.x; x < item.x + item.w; x++) {
      if (spine.has(y * map.width + x)) issue('errors', `${item.kind}: overlaps reserved passage`, x, y);
      if (map.cells[y]?.[x]?.terrain === 'door') issue('errors', `${item.kind}: overlaps door`, x, y);
    }
  }
  if (map.plan?.dungeon?.complex) for (const room of rooms) {
    if (!room.scenes && !room.warnings.length && !['landing', 'entrance', 'cave', 'lake', 'collector'].includes(room.purpose)) {
      const msg = `${room.roomId} (${room.purpose}): no complete functional scene`;
      warnings.push(msg); room.warnings.push(msg);
    }
  }
  return { ok: errors.length === 0, errors, warnings, rooms };
}
