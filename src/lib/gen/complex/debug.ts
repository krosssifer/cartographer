import type { MapData } from '../../types';

/** Independent, opt-in overlay: works with old maps even without generator diagnostics. */
export function drawDungeonDressingDebug(ctx: CanvasRenderingContext2D, map: MapData, cs: number): void {
  const debug = map.plan?.dungeonDressingDebug;
  ctx.save();
  ctx.font = `${Math.max(9, Math.round(cs * .34))}px sans-serif`;
  ctx.lineWidth = Math.max(1, cs * .04);
  for (const p of debug?.spine ?? []) { ctx.fillStyle = 'rgba(0,210,255,.25)'; ctx.fillRect(p.x * cs, p.y * cs, cs, cs); }
  for (const room of map.plan?.rooms ?? []) {
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.strokeRect(room.bounds.x * cs, room.bounds.y * cs, room.bounds.w * cs, room.bounds.h * cs);
    ctx.fillStyle = '#fff'; ctx.fillText(`${room.id}: ${room.purpose}`, room.bounds.x * cs, (room.bounds.y + .4) * cs);
  }
  const objects = map.crypt ?? [];
  const centers = new Set<string>();
  for (const item of objects) {
    const scene = item.dungeonScene;
    if (scene) {
      ctx.strokeStyle = scene.required ? '#4cff78' : '#ffdc54';
      ctx.strokeRect(item.x * cs, item.y * cs, item.w * cs, item.h * cs);
      if (!centers.has(scene.groupId)) {
        centers.add(scene.groupId); ctx.fillStyle = '#4cff78';
        ctx.fillRect((scene.center.x + .4) * cs, (scene.center.y + .4) * cs, cs * .2, cs * .2);
        ctx.fillText(`${scene.variant}`, scene.center.x * cs, scene.center.y * cs);
      }
      if (scene.attachTo) {
        const parent = objects.find((p) => p.dungeonScene?.role === scene.attachTo);
        if (parent) { ctx.beginPath(); ctx.moveTo((item.x + .5) * cs, (item.y + .5) * cs); ctx.lineTo((parent.x + .5) * cs, (parent.y + .5) * cs); ctx.stroke(); }
      }
    }
    if (item.dungeonCluster) {
      const source = item.dungeonCluster.source;
      ctx.strokeStyle = '#dd8dff'; ctx.strokeRect(item.x * cs, item.y * cs, item.w * cs, item.h * cs);
      ctx.beginPath(); ctx.moveTo((item.x + .5) * cs, (item.y + .5) * cs); ctx.lineTo((source.x + .5) * cs, (source.y + .5) * cs); ctx.stroke();
    }
  }
  const rejectedCells = new Set<string>();
  let labels = 0;
  for (const reject of debug?.rejected ?? []) {
    const key = `${reject.x}:${reject.y}`;
    if (rejectedCells.has(key)) continue;
    rejectedCells.add(key);
    ctx.strokeStyle = '#ff4d4d'; ctx.strokeRect(reject.x * cs, reject.y * cs, cs, cs);
    // A bounded set of labels stays readable; all failures remain in the plan.
    if (labels++ < 12) { ctx.fillStyle = '#ff9999'; ctx.fillText(`${reject.kind}: ${reject.reason}`, reject.x * cs, reject.y * cs); }
  }
  ctx.restore();
}
