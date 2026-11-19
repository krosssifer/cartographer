export type Biome = 'forest' | 'plains' | 'swamp' | 'desert' | 'snow' | 'cave' | 'dungeon' | 'village' | 'town';
export type CryptArchetype = 'tomb' | 'catacombs' | 'temple' | 'archive' | 'prison';
export type SettlementStyle = 'village' | 'town';
export type RoofMaterial = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RoofShape = 'gable' | 'hip' | 'cross';
export type CivicKind = 'market' | 'square' | 'well' | 'fountain' | 'cart' | 'garden';
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
  | 'greenRuneStone' | 'flail' | 'crackedPlate';
export type CryptTheme = 'entry' | 'burial' | 'sanctum' | 'ossuary' | 'archive' | 'reliquary' | 'storage' | 'watch';
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
}

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
  cryptDetail: number;
  cryptTraps: boolean;
  cryptChasms: boolean;
  cryptArchetype: CryptArchetype;
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
  vignette: boolean;
}
