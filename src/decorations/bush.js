import { FOLIAGE_COLOR_OPTIONS } from "../constants.js";
import { ezTreeDecoration } from "./lib/ez-tree/decoration.js";

/**
 * Bush decoration: the ez-tree bush presets (EZ_TREE.md). Existing track
 * bushes keep their `bush` id, seed, scale and colour, and pick up bush_1
 * unless they name a preset.
 * Scale: ez-tree bushes are ~19–31 units tall, so 0.12 makes them ~2.3–3.7
 * world units (the old blob bush was ~1.7). Tune by eye.
 */
export default ezTreeDecoration({
  presetFilter: (id) => id.startsWith("bush_"),
  defaultPreset: "bush_1",
  scale: 0.12,
  spread: 2.5, // duplicate scatter distance, ~ a bush radius at 0.12
  colorOptions: FOLIAGE_COLOR_OPTIONS,
});
