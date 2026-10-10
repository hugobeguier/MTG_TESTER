import fs from "fs";
const raw = `1 Ambition's Cost (SCD) 66
1 Arcane Signet (FDC) 245
1 Army of the Damned (FDC) 85
1 Ayara, First of Locthwain (FDC) 86
1 Bad Moon (FDC) 87
1 Barren Moor (DDJ) 78
1 Bojuka Bog (FDC) 296
1 Bonehoard (C16) 245
1 Bontu's Monument (FDC) 247
1 Carrion Feeder (FDC) 88
1 Castle Locthwain (FDC) 299
1 Cemetery Reaper (SCD) 70
1 Cemetery Recruitment (EMN) 83
1 Cemetery Tampering (SNC) 69
1 Champion of the Perished (FDC) 91
1 Charcoal Diamond (FDC) 248
1 Commander's Sphere (C16) 248
1 Consumed by Greed (BLB) 87
1 Consuming Corruption (FDC) 93
1 Crown of Gondor (LTC) 75
1 Cryptbreaker (FDC) 94
1 Death Baron (FDC) 95
1 Diregraf Colossus (FDC) 96
1 Disciple of Bolas (TDC) 178
1 Disciple of Griselbrand (ISD) 98
1 Dissection Tools (DSK) 245
1 Endless Ranks of the Dead (FDC) 97
1 Fleshbag Marauder (ORI) 98
1 Geier Reach Sanitarium (FDC) 303
1 Go for the Throat (FDC) 100
1 Grave Titan (FDC) 102
1 Graveborn Muse (FDC) 103
1 Gravecrawler (FDC) 104
1 Gravespawn Sovereign (SCD) 79
1 Gray Merchant of Asphodel (FDC) 105
1 Headless Rider (FDC) 106
1 Kalitas, Traitor of Ghet (FDC) 108
1 Lashwrithe (C14) 245
1 Liliana's Mastery (FDC) 109
1 Lord of the Accursed (SCD) 88
1 Lord of the Undead (FDC) 112
1 Memorial to Folly (DOM) 242
1 Midnight Reaper (FDC) 114
1 Mind Stone (DMR) 385
1 Mire Triton (SCD) 92
1 Mutilate (FDC) 117
1 Necrotic Hex (SCD) 95
1 Night's Whisper (FDC) 119
1 Noxious Ghoul (PLST) LGN-77
1 Oversold Cemetery (FDC) 122
1 Patchwork Banner (FDC) 279
1 Phyrexian Arena (FDC) 123
1 Phyrexian Reclamation (TDC) 194
1 Sol Ring (FDC) 286
1 Soulless One (FDC) 126
1 Stoneforge Masterwork (OGW) 166
33 Swamp (M15) 259
1 Tendrils of Corruption (DDE) 30
1 Umbral Collar Zealot (EOE) 123
1 Undead Augur (PLST) MH1-112
1 Undead Butler (FDC) 130
1 Undead Warchief (FDC) 131
1 Vengeful Dead (SCD) 117
1 Wight of Precinct Six (DDM) 46
1 Witch's Cottage (FDC) 319
1 Withering Torment (FDC) 134
1 Zul Ashur, Lich Lord (FDC) 135`;
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/\s+\([A-Z0-9]+\)\s+\S+$/, ""));
const total = lines.reduce((n, l) => n + Number.parseInt(l, 10), 0);
console.log("lines", lines.length, "cards", total);
const text = "Commander: Ghoulcaller Gisa\n" + lines.join("\n");
fs.writeFileSync("decks/foundations/WretchedRanks.txt", text + "\n");
// precons.ts constant
const p = "src/lib/precons.ts";
let s = fs.readFileSync(p, "utf8");
const crlf = s.includes("\r\n");
s = s.replace(/\r\n/g, "\n");
const start = s.indexOf("export const WRETCHED_RANKS_DECKLIST = `");
const end = s.indexOf("`;", start);
if (start < 0 || end < 0) throw new Error("precons markers");
s = s.slice(0, start) + "export const WRETCHED_RANKS_DECKLIST = `" + text + s.slice(end);
fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s);
