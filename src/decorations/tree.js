import { TREE_FOLIAGE_COLOR_OPTIONS } from "../constants.js";
import { ezTreeDecoration } from "./lib/ez-tree/decoration.js";

/**
 * Tree decoration: the non-bush ez-tree presets (EZ_TREE.md).
 * Scale: an Oak Medium is ~72 ez-tree units tall, so 0.22 makes it ~16 world
 * units (2× the old procedural tree, tuned by eye in game).
 */
export default ezTreeDecoration({
  presetFilter: (id) => !id.startsWith("bush_"),
  defaultPreset: "oak_medium",
  scale: 0.22,
  colorOptions: TREE_FOLIAGE_COLOR_OPTIONS,
});
