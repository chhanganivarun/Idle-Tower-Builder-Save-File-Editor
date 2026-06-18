# Idle Tower Builder Save Format Notes

## Confirmed Format

The save files are wrapped text:

```text
[A|<payload>]
```

The payload uses the game's custom base64 alphabet:

```text
0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=
```

It is not standard base64. After custom-base64 decoding, the bytes are a zlib
stream. Inflating that stream gives a sequence of big-endian 64-bit floats:

- first double: array length
- remaining doubles: game save number array

The HTML5 build confirms the export path:

```js
this.myWorld.save2Ar(a, 0);
Routines.writeArray2ByteArray(a, b);
b.compress();
a = Routines.encodeByteArray2Base64(b);
clipboard.writeText("[A|" + a + "]");
```

## Tool Commands

`code/save_tool.py` can:

- `info`: show save metadata
- `save-to-json`: decode a save into editable number-array JSON
- `json-to-save`: encode number-array JSON back into a game save string
- `decode`: unwrap a save into the compressed zlib payload
- `encode`: wrap a compressed zlib payload back into a save string
- `save-to-items` / `items-to-save`: legacy temporary item split
- `compare`: compare compressed payloads
- `probe`: inspect compressed payloads

Example:

```powershell
python code/save_tool.py save-to-json "SAVE GAMES\3.txt" decoded\3.json
python code/save_tool.py json-to-save decoded\3.json decoded\3.from-json.txt
```

The rebuilt save string may not be byte-for-byte identical because zlib can
represent the same inflated data with different compressed bytes. Decoding the
rebuilt save does round-trip the same number array.

## Web GUI (`gui/`)

Open `gui/index.html` via a local server from the **repo root** (so `pako.min.js`
and `../decoded/*.json` resolve):

```powershell
python -m http.server 8080
```

Then browse `http://localhost:8080/gui/index.html`.

The editor splits fields into:

- **Main Tower** — auto-locates `MainBabelTower` (class id 19): `numStoriesBuilt`
  (completed floors) and `bricksInCurrentStorey` (visible wall bricks).
- **Moon Stone Tower** — auto-locates `MoonStoneTower` (class id 43): `numStoriesBuilt`
  (moon tower floors) and `progressTillNext` (0–1, shown as % in the UI — e.g. 18.6%
  is stored as `0.186`).
- **Global Save Fields** — fixed header indices including index 22 (`maxTowerHeight`
  prestige record only).

Exported JSON may include `game_data.tower` with discovered indices for the
current save.

## JSON Shape

```json
{
  "format": "idle-tower-builder-save-json",
  "codec": "game-array-v1",
  "game_data": {
    "type": "number_array",
    "count": 3085,
    "values": [2, 1779878498897, 11],
    "annotations": {},
    "tower": {
      "class_id": 19,
      "num_stories_built_index": 356,
      "bricks_in_current_storey_index": 358,
      "num_stories_built": 63,
      "bricks_in_current_storey": 29
    }
  }
}
```

`game_data.tower` is optional metadata written by the GUI; `save_tool.py` ignores it.

Editing `game_data.values` changes what is encoded back into the save.

## Numbering Convention

The JSON array is zero-based, but human notes are easier to count one-based.
Use both labels while decoding:

- value #15 = index 14 = `money`
- value #21 = index 20 = `science`
- value #23 = index 22 = `maxTowerHeight` (prestige record at last restart — not live floor count)

The first global values are fixed by the game source:

- index 0: save format version
- index 1: save timestamp in milliseconds
- index 13: prestige / golden bricks
- index 14: money
- index 20: science
- index 21: offline time bonus
- index 22: `maxTowerHeight` — best floors at last restart (prestige); live floors are on `MainBabelTower`
- index 23: golden storeys
- index 24: golden bricks on the top storey

## Repeated Large Numbers Near The End

Numbers such as `1780375301.17` are timestamps in seconds. The base object
save function writes these fields for every object:

- `timeOfCreation`
- `lastCalculatedMomentInSeconds`
- `totalLifeTime`
- `timeofCreationInRealTime`
- `lastCalculatedRealTimeMoment`

That is why the same timestamp can appear dozens of times near the end of a
save: many objects were created or last recalculated at the same moment. These
are useful structural markers, but they are not money, science, resources, or
upgrade levels.

## Leaderboards vs world save

Editing `MainBabelTower.numStoriesBuilt` in the `[A|…]` world save updates the
tower in-game, but **does not** update leaderboard or achievement floor stats by
itself. Those are written only when the game calls `submitFloorsScore` (on each
completed floor during normal play):

| What you see | Where it lives | Updated when |
|--------------|----------------|--------------|
| Tower height in the world | `MainBabelTower.numStoriesBuilt` in world save | Save editor / building floors |
| Achievements tied to floors | `floors_babel_tower` (`lastval`, `totalval`) | `PlayerRankController` in **global** save (`globalFile_G_*_P_*.sav`) |
| Achievements page “your score” / online board | `score_babel_floors` via `EnhanceWrapper` | Host SDK (e.g. CrazyGames), not in world blob |
| Index 22 `maxTowerHeight` | World save header | On **restart** / prestige (`Math.max` with tower); not the live leaderboard |

Trailing fields on the tower object (`currentStateId`, `bricksInCurrentStorey`,
`transportedBricks`) are machine state for animation and the current wall — not
a hidden floor counter for leaderboards.

After loading an edited world save, either complete one more floor in-game or run
in the browser dev console (with the save loaded):

```js
let t = NewGameScreen.screen.currentWorld.findObjectOfClass(MainBabelTower);
NewGameScreen.screen.currentWorld.submitFloorsScore(t.numStoriesBuilt);
```

Contest mode best scores are stored on `BabelContestWorld` / `BabelContestMode.bestResult`
(a separate world type), not in the main campaign world save.

## Storey / Floor Count

There are two related values:

- value #23 / index 22 is `maxTowerHeight`, updated on **restart** (`Math.max` with
  tower floors when you prestige). During a run it can be **lower** than the live
  tower (e.g. record 44 while the tower object has 63 completed floors).
- the current active tower's storeys are saved inside the `MainBabelTower`
  object record as `numStoriesBuilt`.
- bricks shown on the unfinished storey wall are `bricksInCurrentStorey` on the
  same object (visible brick count, not economy stock).

The source confirms the `MainBabelTower` object appends:

```js
a[b+0] = this.baseLevelOnTower;
a[b+1] = this.numStoriesBuilt;
a[b+2] = this.progressTillNext;
a[b+3] = 0;
```

So current storeys should not be edited as one fixed global index. In the
known comparison:

- `3.json`: likely current tower storeys at index 294 = `14`
- `4.json`: likely current tower storeys at index 274 = `15`

The absolute index moved because object records before the tower changed
between saves.

## Activated Machines And Upgrade Levels

The save does not keep a simple true/false list of every activated machine.
It saves the actual world objects.

World object data is written after the fixed world fields and params
controllers:

```js
saveVectorsOfObjects2Ar(a, b) {
  a[b + 0] = this.vecs4Objects.length;
  ...
}
```

Every object starts with `BasicGameObject.save2Ar`:

```js
a[b+0] = this.myWorld.getIndexOfClass(this.myClass);
a[b+1] = this.arId;
a[b+2] = this.vecId;
a[b+3] = this.x;
a[b+4] = this.y;
a[b+5] = this.timeOfCreation;
a[b+6] = this.lastCalculatedMomentInSeconds;
a[b+7] = this.totalLifeTime;
a[b+8] = this.timeofCreationInRealTime;
a[b+9] = this.lastCalculatedRealTimeMoment;
a[b+10] = this.purchaseId;
a[b+11] = this.purchasedOrder;
```

Most machines inherit from `ProcessorOfItems`. That class saves the upgrade
status:

```js
a[b+4] = this.lifetimEarnings;
a[b+5] = this.upgradeLevel;
a[b+6] = this.numResets;
a[b+7] = this.numAdCalls;
```

So activation and upgrade state are tracked like this:

- not-yet-bought unlocks exist as `Slot4BabelMachinePurchase` / `Slot4Purchase`
  objects; these save `idInPurchaser`, which maps back to purchase codes such
  as `PURCH_HELICOPTER`.
- bought/activated machines exist as actual machine objects in the object
  vectors.
- each bought machine object has `purchaseId` and `purchasedOrder` in the base
  object fields.
- each upgradable machine has `upgradeLevel` in its `ProcessorOfItems` fields.
- `NumPurchasesController` separately saves purchased `{id, num}` pairs so the
  game can price/order repeated purchases correctly.

This means an editor needs an object parser. A raw absolute index can change
whenever new objects or purchase slots are inserted before the object we care
about.

## Bricks Placed

The main tower saves four fields after its inherited machine fields:

```js
a[b+0] = this.numStoriesBuilt;
a[b+1] = this.currentStateId;
a[b+2] = this.bricksInCurrentStorey;
a[b+3] = this.transportedBricks;
```

Meaning:

- `numStoriesBuilt`: completed storeys/floors.
- `bricksInCurrentStorey`: bricks already placed in the current unfinished
  storey.
- `transportedBricks`: bricks currently being carried.
- `currentStateId`: tower work animation/state machine.

When a brick is added:

```js
this.bricksInCurrentStorey += a;
```

When the storey completes:

```js
this.numStoriesBuilt++;
this.bricksInCurrentStorey = 0;
```

## Sample 3

`SAVE GAMES\3.txt` decodes to 3085 numeric values. Your visible game-state
notes are stored in `decoded/3.known-values.json`, and a first pass annotated
decode is stored in `decoded/3.annotated.json`.

Exact level matches found in the decoded number array:

- `helicopter_level = 115`: indices 208, 538, 1919
- `newton_level = 75`: index 2249
- `blimp_level = 325`: index 1546
- `windmill_one/two_level = 110`: indices 1763, 1814
- `steam_machine_level = 144`: index 1259
- `drum_level = 180`: index 1208
- `quarry_level = 288`: index 318
- `stone_transport_level = 115`: indices 208, 538, 1919
- `elephant_level = 280`: index 1364
- `brick_producer_level = 224`: index 427
- `field_level = 116`: index 1440
- `tent_level = 108`: index 2029
- `sprinkler_level = 128`: index 1865
- `plank_producer_level = 216`: index 825
- `forest_level = 252`: index 771
- `well_level = 518`: index 1158
- `water_extractor_level = 210`: index 1656
- `wood_transporter_level = 250`: index 993

Approximate resource candidates:

- science around 3.84M: index 20 = `3807659.700000014`
- stone around 583 sextillion: index 399 = `6.470649755766574e+23`
- stone in brick producer around 47 quintillion: index 457 =
  `5.25014780237044e+19`
- bricks around 4.23 quintillion: index 510 = `3.0095606009967263e+18`
- hay around 40 quadrillion: indices 1083, 1084, 1736 =
  `3.726762538141696e+16`
- wood at plank producer around 589T: index 855 =
  `565417934228391.0`
- planks around 91T: index 965 = `89032882673845.0`

## Important Caveat

Some level values appear multiple times. For example, `115` appears at indices
208, 538, and 1919. A controlled before/after save is still needed to decide
which one is helicopter level, stone transport level, or another coincidental
value.

## Sample 4

`SAVE GAMES\4.txt` was supplied as the save with 15 floors completed.

It decodes to 3118 numeric values. A sequence-aligned comparison against
`3.txt` shows the likely current main tower floor field:

- `3.json` index 294 = `14`
- `4.json` index 274 = `15`

The absolute index changed because records before that field were inserted or
removed between saves. This field should be treated as a structural/object
field, not a fixed global index across every save.

Annotated files:

- `decoded/3.floor-annotated.json`
- `decoded/4.floor-annotated.json`
- `decoded/4.known-values.json`
