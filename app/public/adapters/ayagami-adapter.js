// NyaL2D adapter wrapper for the Ayagami runtime (contract v1): EMPTY.
//
// This is the default module behind the Ayagami slot in Settings. It
// implements the contract's shape but is not connected to Ayagami yet, so
// it reports `meta.connected = false` and the app shows a "not connected"
// state instead of trying to open models.
//
// It contains no Ayagami code. Ayagami's AGENTS.md asks AI agents not to
// research, analyze or write code for it, so the AI sessions working on
// NyaL2D did not read Ayagami's source and will not fill this in. A person
// connecting it builds Ayagami for the browser and fills each TODO below
// using only Ayagami's own public API, then sets `connected` to true.
//
// Contract: docs/runtime/adapter-contract.md
// Fully working reference: ./example-adapter.js

export const nyal2dAdapter = 1;

export const meta = {
  name: "Ayagami",
  version: "0.0.0",
  // TODO: model file extensions Ayagami opens, e.g. ".zip".
  accept: "",
  // TODO: motion modes the runtime provides besides "off", e.g. ["idle"].
  motionModes: [],
  // Set to true once load() and the parameter functions are implemented.
  connected: false,
};

const NOT_CONNECTED = "Ayagami 런타임이 아직 연결되지 않았습니다 (adapters/ayagami-adapter.js는 빈 래퍼입니다)";

export async function create(canvas) {
  // TODO: load the Ayagami browser build and create its renderer on `canvas`.
  // The app gives each runtime a fresh canvas sized by CSS; match the drawing
  // buffer to clientWidth × devicePixelRatio.
  void canvas;

  /** @type {{id: string, name?: string, min: number, max: number, default: number}[]} */
  let params = [];
  const values = new Map();
  let name;

  return {
    async load(files) {
      // TODO: open `files` with Ayagami (files = [] means a built-in sample,
      // or throw if there is none), then fill `params`, `values` and `name`
      // from the loaded model.
      void files;
      throw new Error(NOT_CONNECTED);
    },

    parameters() {
      return params;
    },

    getParameter(id) {
      // TODO: read the value from Ayagami.
      return values.get(id) ?? 0;
    },

    setParameter(id, value) {
      // TODO: write the value to Ayagami. The app has already clamped it.
      values.set(id, value);
    },

    modelName() {
      return name;
    },

    setMotionMode(mode) {
      // TODO: start or stop Ayagami's own motion for `mode` ("off" stops all).
      void mode;
    },

    drivenParameterIds() {
      // TODO: ids Ayagami's own motion writes each frame, so the app can show them.
      return [];
    },

    destroy() {
      // TODO: stop the render loop and free Ayagami's GPU resources.
      params = [];
      values.clear();
    },
  };
}
