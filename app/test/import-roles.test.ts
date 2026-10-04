import { describe, expect, it } from "vitest";
import { RIG_ROLES } from "../src/import/layer-import";
import { assignRoles, featureOf, sideOf, visibleChildren, type RawLayerInfo, type RoleAssignment } from "../src/import/roles";

const ROLES: ReadonlySet<string> = new Set(RIG_ROLES);

/** A 1000×1000 character: face centred at x 400..600, eyes either side of x 500. */
function layer(path: string[], order: number, bbox: RawLayerInfo["bbox"] = { x: 420, y: 300, w: 40, h: 20 }): RawLayerInfo {
  return { path, order, bbox };
}
const FACE = { x: 400, y: 200, w: 200, h: 260 };
const BOTH_EYES = { x: 430, y: 300, w: 140, h: 30 };
const VIEWER_RIGHT = { x: 530, y: 300, w: 40, h: 30 };
const VIEWER_LEFT = { x: 430, y: 300, w: 40, h: 30 };

function roleOf(a: RoleAssignment): string | null | [string, string, number] {
  return a.kind === "split" ? [a.L, a.R, a.atX] : a.role;
}

describe("featureOf", () => {
  it.each([
    ["front hair", "hair_front"],
    ["back hair", "hair_back"],
    ["irides", "iris"],
    ["eyewhite", "eye"],
    ["eyelash", "lash"],
    ["eyebrow", "brow"],
    ["topwear", "body"],
    ["neckwear", "body"],
    ["headwear", "hair_front"],
    ["ears", "face"],
    ["前髪", "hair_front"],
    ["後ろ髪", "hair_back"],
    ["*普通目", "eye"],
    ["黒目", "iris"],
    ["白目", "eye"],
    ["!眉", "brow"],
    ["*ほほえみ口", "mouth"],
    ["顔色", "blush"],
    ["顔", "face"],
    ["!頭", "face"],
    ["体", "body"],
    ["속눈썹", "lash"],
    ["눈썹", "brow"],
    ["왼눈", "eye"],
    ["앞머리", "hair_front"],
    ["EyeWhiteL", "eye"],
    ["Layer 3", undefined],
    ["レイヤー 1", undefined],
  ])("%s → %s", (name, feature) => {
    expect(featureOf(name)).toBe(feature);
  });
});

describe("sideOf", () => {
  it.each([
    ["eye_L", "L"],
    ["Eye-R", "R"],
    ["left eye", "L"],
    ["browR", "R"],
    ["左目", "L"],
    ["오른눈", "R"],
    ["eyewhite", undefined],
    ["Layer", undefined],
  ])("%s → %s", (name, side) => {
    expect(sideOf(name)).toBe(side);
  });
});

describe("assignRoles", () => {
  it("keeps exact Iki role names", () => {
    const a = assignRoles([layer(["face.png"], 0, FACE), layer(["eye_L.png"], 1), layer(["Eye-R.png"], 2), layer(["mouth.png"], 3)], ROLES);
    expect(a.map(roleOf)).toEqual(["face", "eye_L", "eye_R", "mouth"]);
  });

  it("maps See-Through tags and splits a both-eyes layer at the face centre", () => {
    const a = assignRoles(
      [
        layer(["back hair"], 0, { x: 350, y: 150, w: 300, h: 500 }),
        layer(["neck"], 1, { x: 460, y: 440, w: 80, h: 80 }),
        layer(["topwear"], 2, { x: 300, y: 500, w: 400, h: 500 }),
        layer(["face"], 3, FACE),
        layer(["eyewhite"], 4, BOTH_EYES),
        layer(["irides"], 5, BOTH_EYES),
        layer(["eyelash"], 6, BOTH_EYES),
        layer(["eyebrow"], 7, { x: 425, y: 270, w: 150, h: 20 }),
        layer(["nose"], 8, { x: 490, y: 350, w: 20, h: 20 }),
        layer(["mouth"], 9, { x: 480, y: 400, w: 40, h: 15 }),
        layer(["front hair"], 10, { x: 380, y: 150, w: 240, h: 200 }),
      ],
      ROLES,
    );
    expect(a.map(roleOf)).toEqual([
      "hair_back",
      "body",
      "body",
      "face",
      ["eye_L", "eye_R", 500],
      ["iris_L", "iris_R", 500],
      ["lash_L", "lash_R", 500],
      ["brow_L", "brow_R", 500],
      "nose",
      "mouth",
      "hair_front",
    ]);
  });

  it("gives one-sided layers the side they sit on: _L is the viewer's right", () => {
    const a = assignRoles([layer(["顔"], 0, FACE), layer(["目", "白目a"], 1, VIEWER_RIGHT), layer(["目", "白目b"], 2, VIEWER_LEFT)], ROLES);
    expect(a.map(roleOf)).toEqual(["face", "eye_L", "eye_R"]);
  });

  it("prefers a side in the name over the position", () => {
    const a = assignRoles([layer(["face"], 0, FACE), layer(["eye_white_left"], 1, VIEWER_LEFT)], ROLES);
    expect(a.map(roleOf)).toEqual(["face", "eye_L"]);
  });

  it("reads a layer's role from its groups when its own name says nothing (立ち絵 PSD)", () => {
    const a = assignRoles(
      [
        layer(["ずんだもん", "体", "服"], 0, { x: 300, y: 450, w: 400, h: 550 }),
        layer(["ずんだもん", "顔", "輪郭"], 1, FACE),
        layer(["ずんだもん", "顔", "顔色", "*ほっぺ"], 2, { x: 420, y: 360, w: 160, h: 30 }),
        layer(["ずんだもん", "!眉", "*普通眉"], 3, { x: 425, y: 270, w: 150, h: 20 }),
        layer(["ずんだもん", "!目", "*普通目"], 4, BOTH_EYES),
        layer(["ずんだもん", "!口", "*ほう"], 5, { x: 480, y: 400, w: 40, h: 15 }),
        layer(["ずんだもん", "前髪", "レイヤー 7"], 6, { x: 380, y: 150, w: 240, h: 200 }),
        layer(["ずんだもん", "枝豆"], 7, { x: 450, y: 50, w: 100, h: 120 }),
        layer(["ずんだもん", "そばかす"], 8, { x: 450, y: 340, w: 100, h: 20 }),
      ],
      ROLES,
    );
    expect(a.map(roleOf)).toEqual([
      "body",
      "face",
      ["blush_L", "blush_R", 500],
      ["brow_L", "brow_R", 500],
      ["eye_L", "eye_R", 500],
      "mouth",
      "hair_front",
      "hair_front", // unnamed, in front of the face, outside it
      "face", // unnamed, in front of the face, inside it
    ]);
  });

  it("puts unnamed layers behind the face on the body and drops empty ones", () => {
    const a = assignRoles([layer(["Layer 1"], 0, { x: 0, y: 600, w: 1000, h: 400 }), layer(["face"], 1, FACE), layer(["Layer 3"], 2, null)], ROLES);
    expect(a.map(roleOf)).toEqual(["body", "face", null]);
  });

  it("sends generic hair behind or in front of the face by stack order", () => {
    const a = assignRoles([layer(["髪"], 0, FACE), layer(["face"], 1, FACE), layer(["髪 2"], 2, FACE)], ROLES);
    expect(a.map(roleOf)).toEqual(["hair_back", "face", "hair_front"]);
  });
});

describe("visibleChildren (PSDTool)", () => {
  it("shows the visible * variant, every ! layer, and skips hidden and flipped ones", () => {
    const kids = [
      { name: "*普通目", hidden: true },
      { name: "*笑い目", hidden: false },
      { name: "*閉じ目", hidden: true },
      { name: "!輪郭", hidden: true },
      { name: "影", hidden: true },
      { name: "線", hidden: false },
      { name: "*笑い目:flipx", hidden: false },
    ];
    expect(visibleChildren(kids).map((k) => k.name)).toEqual(["*笑い目", "!輪郭", "線"]);
  });

  it("falls back to the top-most * variant when none is visible", () => {
    const kids = [{ name: "*a", hidden: true }, { name: "*b", hidden: true }];
    expect(visibleChildren(kids).map((k) => k.name)).toEqual(["*b"]);
  });
});
