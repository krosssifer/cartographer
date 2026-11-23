import type { GenerationPlan } from './gen/plan';

export type Biome = 'forest' | 'plains' | 'swamp' | 'desert' | 'snow' | 'cave' | 'dungeon' | 'village' | 'town';
export type CryptArchetype = 'tomb' | 'catacombs' | 'temple' | 'archive' | 'prison';
export type SettlementStyle = 'village' | 'town';
export type RoofMaterial = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RoofShape = 'gable' | 'hip' | 'cross';
export type CivicKind = 'market' | 'square' | 'well' | 'fountain' | 'cart' | 'garden'
  // рыночная площадь (спрайт-лист)
  | 'marketTentStripe' | 'marketTentBrown' | 'marketTentAwning' | 'marketTentRound'
  | 'marketTentCanopy' | 'marketTentPatch' | 'marketTentTarp' | 'marketTentBurlap'
  | 'marketStallProduce' | 'marketStallFruit' | 'marketStallBread' | 'marketStallGrain'
  | 'marketStallMeat' | 'marketStallPottery' | 'marketStallFabric' | 'marketStallPotion'
  | 'marketStallTools' | 'marketStallFish' | 'marketStallCheese' | 'marketStallTextiles' | 'marketStallSweets'
  | 'marketWagon' | 'marketWagonCovered' | 'marketWheelbarrow' | 'marketWheelbarrowStone'
  | 'marketCrates' | 'marketBarrels' | 'marketSacks' | 'marketRope' | 'marketChest'
  | 'marketChestOpen' | 'marketBaskets' | 'marketBarrelPair' | 'marketNoticeBoard'
  | 'marketWell' | 'marketHay' | 'marketBarrelLying'
  | 'marketBench' | 'marketTable' | 'marketTableLong' | 'marketFence' | 'marketHayLarge' | 'marketTableSet';
export type MarketStyle = 'auto' | 'rows' | 'ring' | 'fair';
export type CryptKind =
  | 'chasm' | 'pit' | 'grate' | 'bridge' | 'spikeGlyph' | 'pressureTile' | 'runeTrap' | 'fallSeal'
  | 'skeleton' | 'bones' | 'urns' | 'coffin' | 'openCoffin' | 'altar' | 'lectern' | 'runeCircle' | 'steps' | 'pillar' | 'statue' | 'brazier'
  | 'incense' | 'candles' | 'chains' | 'web' | 'rubble' | 'bench' | 'writingDesk' | 'barrels' | 'crates' | 'bookcase' | 'chest' | 'rug'
  // опасности
  | 'spikes' | 'dartHole' | 'tripwire' | 'swingingBlade' | 'trapNet' | 'poisonVent' | 'falseDoor' | 'illusoryWall' | 'crushBlock'
  | 'pitTrap' | 'sinkhole' | 'drain' | 'sewerGrate' | 'mineRails' | 'collapse' | 'crackedFloor' | 'bearTrap' | 'snareRope' | 'swingingLog'
  | 'dartWall' | 'rubblePile' | 'rockFall' | 'boneSnare'
  // погребение
  | 'skull' | 'ribcage' | 'pelvis' | 'spine' | 'femurs' | 'jaw' | 'graveStone' | 'tomb' | 'mausoleum' | 'burialNiche'
  | 'sarcophagusLid' | 'corpse' | 'wrappedBody' | 'graveDirt' | 'ossuaryShelf' | 'catacombArch' | 'bonePile' | 'graveCandle' | 'wreath'
  | 'burialUrn' | 'pyre' | 'cryptPodium' | 'nameTomb' | 'reliquaryUrn' | 'skeletonPile' | 'coffinLid' | 'mournerStatue'
  // реликвии
  | 'pedestal' | 'idol' | 'obelisk' | 'shrine' | 'offeringBowl' | 'chalice' | 'goblet' | 'mask' | 'banner' | 'tapestry'
  | 'curtain' | 'mirror' | 'orrery' | 'globe' | 'astrolabe' | 'ledger' | 'mapTable' | 'telescope' | 'inkwell' | 'waxSeal' | 'bell'
  | 'ancientSigil' | 'relicCase' | 'candleWheel' | 'sacrificialKnife' | 'boneCharm' | 'stoneEye' | 'crystalCluster' | 'glowingMushroom' | 'candleStand' | 'brassScale' | 'templeMask'
  // обстановка
  | 'crateStack' | 'barrelStack' | 'sackPile' | 'bucket' | 'toolRack' | 'anvil' | 'forge' | 'bellows' | 'cauldron' | 'workbench'
  | 'vise' | 'mineCart' | 'ladder' | 'scaffold' | 'rope' | 'pulley' | 'winch' | 'counterweight' | 'shelf' | 'scrollRack'
  | 'hayPile' | 'cage' | 'cageDoor' | 'pillory' | 'stocks' | 'manacles' | 'tortureRack' | 'gibbet' | 'brazierStand' | 'candleHolder'
  | 'sawhorse' | 'barrelTap' | 'coalHeap' | 'toolbox' | 'net' | 'bucketStand' | 'crateOpen' | 'beamSupport' | 'dryingRack' | 'ropeCoil' | 'signalHorn' | 'oilLamp' | 'oldCradle' | 'fishNet'
  // природа и утварь (спрайт-лист)
  | 'boulder' | 'rockPile' | 'scree' | 'rockSpikes' | 'rockSpire' | 'pebbles' | 'rockOutcrop' | 'stoneWell'
  | 'stalagmites' | 'stalactites' | 'puddleBlue' | 'puddleMud' | 'puddleAcid'
  | 'mossGrass' | 'mushroomsGlow' | 'mossPatch' | 'bushPatch' | 'ivyWall' | 'roots' | 'lichen'
  | 'dirtPatch' | 'cracks' | 'nestEggs' | 'skeletonBones' | 'logs' | 'crystals'
  // ловушки и механизмы (второй спрайт-лист)
  | 'pitSquare' | 'pitRound' | 'pitSpikes' | 'spikeField' | 'spikeFieldBloody' | 'spikeRack'
  | 'spikedWheel' | 'sawBlade' | 'axeBlade' | 'sawBar' | 'portcullis' | 'portcullisWood'
  | 'wreckingBall' | 'dartHoleWall' | 'bladeSlot' | 'pressurePlate' | 'pressurePlateRound'
  | 'pressurePlateRusty' | 'buttonPanel' | 'gear' | 'gearCog' | 'chainPulley' | 'pulleyBlock'
  | 'lever' | 'leverBlade' | 'doorWood' | 'doorMetal' | 'doorRound' | 'doorBarred' | 'gateBars'
  | 'hangingCage' | 'pedestalStatue' | 'orbRed' | 'bust' | 'runeBlue' | 'runeCircleBlue' | 'runeCirclePurple'
  | 'greenRuneStone' | 'flail' | 'crackedPlate'
  // переходы между уровнями подземелья
  | 'stairsDown' | 'stairsUp'
  // архитектурные комплексы: свет и вертикальные связи
  | 'wallTorch' | 'chandelier' | 'magicLamp' | 'spiralStairs' | 'liftPlatform';
export type CryptTheme = 'entry' | 'burial' | 'sanctum' | 'ossuary' | 'archive' | 'reliquary' | 'storage' | 'watch'
  // залы разнообразной планировки: жилые покои, мастерская, тюремная камера
  | 'quarters' | 'forge' | 'cell';
/** Планировка подземелья: прежняя (прямоугольные залы) или разнообразная. */
export type DungeonLayout = 'classic' | 'varied';
/** Вид дверного проёма. Клетка остаётся terrain 'door', вид хранится в MapData.doors. */
export type DoorKind = 'normal' | 'double' | 'arch' | 'secret' | 'broken' | 'blocked' | 'portcullis' | 'gate';
export interface DoorMark { x: number; y: number; kind: DoorKind }
export type CryptPlacement = 'wall' | 'wallFace' | 'center' | 'corner' | 'any';

export type Terrain =
  | 'deepWater'
  | 'water'
  | 'sand'
  | 'grass'
  | 'darkGrass'
  | 'dirt'
  | 'mud'
  | 'rock'
  | 'snow'
  | 'ice'
  | 'road'
  | 'bridge'
  | 'floor'
  | 'wall'
  | 'door'
  | 'caveFloor'
  | 'caveWall'
  | 'plaza'
  | 'buildingFloor'
  | 'buildingWall'
  | 'roof'
  | 'void';

export interface Cell {
  terrain: Terrain;
  height: number;
  moisture: number;
}

export type TreeKind = 'oak' | 'pine' | 'bush' | 'dead' | 'cactus' | 'mushroom' | 'reed';

export interface Tree {
  x: number; // в клетках (дробные координаты)
  y: number;
  r: number; // радиус в клетках
  kind: TreeKind;
  v: number; // вариация 0..1
  size?: ObjectDimensions;
}

export interface Rock {
  x: number;
  y: number;
  r: number;
  pts: [number, number][]; // полигон, относительные координаты в клетках
  v: number;
  size?: ObjectDimensions;
}

export interface Structure {
  x: number;
  y: number;
  w: number;
  h: number;
  ruin: boolean;
}

export type BuildingAnnex = 'porch' | 'wing' | 'awning' | 'dormer' | 'battlement';
export type BuildingRole =
  | 'house' | 'workshop' | 'shop' | 'warehouse' | 'tavern'
  | 'town_hall' | 'temple' | 'minor_temple' | 'citadel' | 'barracks'
  | 'prison' | 'smithy' | 'mill' | 'baths' | 'stable' | 'manor';

export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  style: SettlementStyle;
  kind: 'house' | 'hall' | 'tower' | 'shop' | 'tavern';
  roof: RoofMaterial;
  shape?: RoofShape;
  source?: 'layout' | 'manual';
  door: Point;
  facing?: ChestRotation;
  furniture?: Furnishing[];
  /** Небольшой архитектурный выступ/навес/крыльцо (только типизированный генератор). */
  annex?: BuildingAnnex;
  /** Городское назначение здания (склад, кузница, ратуша, храм, казарма…). */
  role?: BuildingRole;
}

export interface Point {
  x: number;
  y: number;
}

export type ChestRotation = 0 | 90 | 180 | 270;
export type ChestKind = 'wooden' | 'stone' | 'ornate';
export interface ObjectDimensions { w: number; h: number }
export type ObjectTarget = { type: 'chest' | 'crypt' | 'civic' | 'tree' | 'rock' | 'building'; index: number }
  | { type: 'furniture'; index: number; building: number };

export type FurnitureKind = 'table' | 'chair' | 'bar' | 'bed' | 'wardrobe' | 'hearth' | 'rug' | 'barrels' | 'crates'
  | 'bookcase' | 'stove' | 'worktop' | 'desk' | 'cupboard' | 'jars' | 'bench' | 'stool' | 'linen' | 'trunk' | 'lantern' | 'basin' | 'screen' | 'basket' | 'longTable';
export interface Furnishing extends Point {
  kind: FurnitureKind;
  rotation: ChestRotation;
  finish?: FurnitureFinish;
  sprite?: string;
  size?: ObjectDimensions;
}
export type FurnitureFinish = 'oak' | 'walnut' | 'moss' | 'ash';
export interface FurnitureSprite {
  id: string;
  label: string;
  kind: FurnitureKind;
  data: string;
  ratio: number;
}
export interface Chest extends Point {
  rotation: ChestRotation;
  kind?: ChestKind;
  size?: ObjectDimensions;
}

export interface CivicObject extends Selection {
  kind: CivicKind;
  rotation: ChestRotation;
  variant: number;
  source: 'layout' | 'manual';
}

export interface CryptObject extends Selection {
  kind: CryptKind;
  rotation: ChestRotation;
  variant: number;
  source: 'layout' | 'manual';
  hidden?: boolean;
  /** Светильник погашен (заброшенный комплекс): рисуется без свечения. */
  unlit?: boolean;
}

export interface CryptRoom extends Selection { theme: CryptTheme }

export type LayerId = 'terrain' | 'trees' | 'rocks' | 'structures' | 'civic' | 'chests' | 'crypt';

export interface MapData {
  width: number;
  height: number;
  biome: Biome;
  cells: Cell[][];
  trees: Tree[];
  rocks: Rock[];
  structures: Structure[];
  buildings?: Building[];
  civic?: CivicObject[];
  crypt?: CryptObject[];
  cryptRooms?: CryptRoom[];
  furnitureSprites?: FurnitureSprite[];
  chests: Chest[];
  river: Point[];
  road: Point[];
  /** Виды дверей по клеткам terrain 'door' (optional: без записи — обычная дверь). */
  doors?: DoorMark[];
  /** Структурный план (зоны/POI/группы). Optional — старые карты без него валидны. */
  plan?: GenerationPlan;
  /**
   * Покрытие пола архитектурного комплекса: строка width·height символов
   * (см. gen/complex/styles.ts FLOOR_CODES; '.' — без покрытия) и орнаменты
   * в центрах залов. Optional — карты без него рисуются как раньше.
   */
  floorLayer?: FloorLayer;
}

export interface FloorOrnament { x: number; y: number; r: number; kind: 'rosette' | 'star' | 'ring' | 'sun' }
export interface FloorLayer { codes: string; ornaments: FloorOrnament[] }

export interface GenSettings {
  seed: number;
  biome: Biome;
  width: number;
  height: number;
  roughness: number; // 0..1
  waterLevel: number; // 0..1
  vegetation: number; // 0..1
  rocks: number; // 0..1
  structures: number; // 0..6
  ruined: boolean;
  river: boolean;
  road: boolean;
  caveOpenness: number; // 0..1
  rooms: number; // для подземелий
  // village / town
  settlement: SettlementStyle;
  density: number;
  publicSpaces: boolean;
  marketStyle: MarketStyle;
  marketRichness: number;
  cryptDetail: number;
  cryptTraps: boolean;
  cryptChasms: boolean;
  cryptArchetype: CryptArchetype;
  /** Движок генерации: структурный pipeline или прежний поклеточный. */
  generationEngine?: 'legacy' | 'structured';
  /**
   * Сцена-архетип для открытых биомов ('auto' или отсутствие — прежняя
   * генерация). Значение — id из реестра gen/archetypes.ts.
   */
  sceneArchetype?: string;
  /** Планировка подземелья ('classic' или отсутствие — прежние прямоугольные залы). */
  dungeonLayout?: DungeonLayout;
  /** Число связанных уровней подземелья (1–4, только для 'varied'). */
  dungeonLevels?: number;
  /** Открытый уровень подземелья (0 — верхний). */
  dungeonLevel?: number;
  /**
   * Архитектурный комплекс (gen/complex/registry.ts): крепость, шахта, храм…
   * Отсутствие поля — прежние генераторы склепа (классический и разнообразный).
   */
  dungeonArchetype?: string;
  /** Топология графа комплекса: 'auto' — по архетипу и seed. */
  dungeonTopology?: string;
  /** Геометрия залов: прямоугольная, разнообразная, органическая. */
  dungeonGeometry?: string;
  /** Архитектурный стиль: 'auto' — стиль архетипа. */
  dungeonStyle?: string;
  /** Состояние сооружения: 'auto' — по архетипу и seed. */
  dungeonCondition?: string;
  /** Тип поселения ('classic' или отсутствие — прежняя планировка). Id из gen/settlementTypes.ts. */
  settlementType?: string;
  /** Схема улиц ('auto' — по типу поселения). */
  settlementLayout?: string;
  /** Исторический характер города ('auto' или отсутствие — по типу поселения). */
  settlementCharacter?: string;
  /**
   * Архетип рынка: 'auto' — по поселению, воде и размеру; id из
   * gen/marketArchetypes.ts; 'classic' или отсутствие — прежний рынок.
   */
  marketArchetype?: string;
}

export interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EditorTool = 'brush' | 'eraser' | 'fill' | 'rect' | 'select' | 'hand' | 'tree' | 'rock' | 'structure' | 'pick' | 'paste' | 'chest' | 'building' | 'roof' | 'civic' | 'furniture' | 'crypt';
export type BrushShape = 'round' | 'square';

export interface EditorSettings {
  tool: EditorTool;
  terrain: Terrain;
  brushSize: number;
  brushShape: BrushShape;
  treeKind: TreeKind;
  snap: boolean;
  chestRotation: ChestRotation;
  roofMaterial: RoofMaterial;
  roofShape: RoofShape;
  civicKind: CivicKind;
  stampRotation: ChestRotation;
  buildingSize: number;
  civicSize: number;
  furnitureKind: FurnitureKind;
  furnitureErase: boolean;
  furnitureFinish: FurnitureFinish;
  furnitureSprite: string;
  cryptKind: CryptKind;
  cryptErase: boolean;
  cryptConceal: boolean;
  chestKind: ChestKind;
  objectSizes: Record<string, ObjectDimensions>;
  sizeLock: boolean;
  sizeUnit: 'cells' | 'feet';
  /** Вид двери, которую ставит кисть террейна «Дверь». */
  doorKind?: DoorKind;
}

export interface SettlementDebugLayers {
  terrainInfluence?: boolean;
  districts?: boolean;
  districtLabels?: boolean;
  primaryRoads?: boolean;
  secondaryRoads?: boolean;
  plots?: boolean;
  footprints?: boolean;
  landmarks?: boolean;
  accessibility?: boolean;
  roadHierarchy?: boolean;
  urbanAge?: boolean;
}

export interface RenderSettings {
  cellSize: number;
  showGrid: boolean;
  gridType: 'square' | 'hex';
  gridOpacity: number;
  gridColor: string;
  shading: boolean;
  texture: boolean;
  /** Толщина стен в клетках; применяется к подземельям. */
  wallThickness: number;
  showTrees: boolean;
  showRocks: boolean;
  showStructures: boolean;
  showChests: boolean;
  showRoofs: boolean;
  showCivic: boolean;
  showCrypt: boolean;
  showSecrets: boolean;
  /** Debug-разметка: зоны, POI, группы и дороги генератора. */
  showDebug?: boolean;
  /** Индивидуальные слои debug-режима поселения. */
  settlementDebug?: SettlementDebugLayers;
  /** Мелкий декор (трава, цветы, камешки, мох) — слой поверх земли. */
  showDecor?: boolean;
  vignette: boolean;
}